/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useInput } from 'ink';
import {
  Config,
  GeminiClient,
  GeminiEventType as ServerGeminiEventType,
  ServerGeminiStreamEvent as GeminiEvent,
  ServerGeminiContentEvent as ContentEvent,
  ServerGeminiErrorEvent as ErrorEvent,
  ServerGeminiChatCompressedEvent,
  getErrorMessage,
  isNodeError,
  MessageSenderType,
  ToolCallRequestInfo,
  logUserPrompt,
  GitService,
  EditorType,
  ThoughtSummary,
  UnauthorizedError,
  UserPromptEvent,
} from '@google/gemini-cli-core';
import { type Part, type PartListUnion } from '@google/genai';
import {
  StreamingState,
  HistoryItem,
  HistoryItemWithoutId,
  HistoryItemToolGroup,
  MessageType,
  ToolCallStatus,
} from '../types.js';
import { isAtCommand } from '../utils/commandUtils.js';
import { parseAndFormatApiError } from '../utils/errorParsing.js';
import { useShellCommandProcessor } from './shellCommandProcessor.js';
import { handleAtCommand } from './atCommandProcessor.js';
import { findLastSafeSplitPoint } from '../utils/markdownUtilities.js';
import { useStateAndRef } from './useStateAndRef.js';
import { UseHistoryManagerReturn } from './useHistoryManager.js';
import { useLogger } from './useLogger.js';
import { promises as fs } from 'fs';
import path from 'path';
import {
  useReactToolScheduler,
  mapToDisplay as mapTrackedToolCallsToDisplay,
  TrackedToolCall,
  TrackedCompletedToolCall,
  TrackedCancelledToolCall,
} from './useReactToolScheduler.js';

export function mergePartListUnions(list: PartListUnion[]): PartListUnion {
  const resultParts: PartListUnion = [];
  for (const item of list) {
    if (Array.isArray(item)) {
      resultParts.push(...item);
    } else {
      resultParts.push(item);
    }
  }
  return resultParts;
}

enum StreamProcessingStatus {
  Completed,
  UserCancelled,
  Error,
}

/**
 * Manages the Gemini stream, including user input, command processing,
 * API interaction, and tool call lifecycle.
 */
export const useGeminiStream = (
  geminiClient: GeminiClient,
  history: HistoryItem[],
  addItem: UseHistoryManagerReturn['addItem'],
  setShowHelp: React.Dispatch<React.SetStateAction<boolean>>,
  config: Config,
  onDebugMessage: (message: string) => void,
  handleSlashCommand: (
    cmd: PartListUnion,
  ) => Promise<
    import('./slashCommandProcessor.js').SlashCommandActionReturn | boolean
  >,
  shellModeActive: boolean,
  getPreferredEditor: () => EditorType | undefined,
  onAuthError: () => void,
  performMemoryRefresh: () => Promise<void>,
) => {
  const [initError, setInitError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const turnCancelledRef = useRef(false);
  const [isResponding, setIsResponding] = useState<boolean>(false);
  const [thought, setThought] = useState<ThoughtSummary | null>(null);
  const [pendingHistoryItemRef, setPendingHistoryItem] =
    useStateAndRef<HistoryItemWithoutId | null>(null);
  const processedMemoryToolsRef = useRef<Set<string>>(new Set());
  const logger = useLogger();
  const gitService = useMemo(() => {
    if (!config.getProjectRoot()) {
      return;
    }
    return new GitService(config.getProjectRoot());
  }, [config]);

  const [toolCalls, scheduleToolCalls, markToolsAsSubmitted] =
    useReactToolScheduler(
      async (completedToolCallsFromScheduler) => {
        // This onComplete is called when ALL scheduled tools for a given batch are done.
        onDebugMessage(`onComplete callback triggered with ${completedToolCallsFromScheduler.length} completed tools`);
        
        if (completedToolCallsFromScheduler.length > 0) {
          onDebugMessage(`onComplete: Processing ${completedToolCallsFromScheduler.length} completed tools`);
          
          // Add the final state of these tools to the history for display.
          addItem(
            mapTrackedToolCallsToDisplay(
              completedToolCallsFromScheduler as TrackedToolCall[],
            ),
            Date.now(),
          );

          // Handle tool response submission immediately when tools complete
          await handleCompletedTools(
            completedToolCallsFromScheduler as TrackedToolCall[],
          );
        } else {
          onDebugMessage('onComplete callback triggered with empty array - ignoring to prevent loop');
        }
      },
      config,
      setPendingHistoryItem,
      getPreferredEditor,
    );

  const pendingToolCallGroupDisplay = useMemo(
    () =>
      toolCalls.length ? mapTrackedToolCallsToDisplay(toolCalls) : undefined,
    [toolCalls],
  );

  const onExec = useCallback(async (done: Promise<void>) => {
    setIsResponding(true);
    await done;
    setIsResponding(false);
  }, []);
  const { handleShellCommand } = useShellCommandProcessor(
    addItem,
    setPendingHistoryItem,
    onExec,
    onDebugMessage,
    config,
    geminiClient,
  );

  const streamingState = useMemo(() => {
    if (toolCalls.some((tc) => tc.status === 'awaiting_approval')) {
      return StreamingState.WaitingForConfirmation;
    }
    if (
      isResponding ||
      toolCalls.some(
        (tc) =>
          tc.status === 'executing' ||
          tc.status === 'scheduled' ||
          tc.status === 'validating' ||
          ((tc.status === 'success' ||
            tc.status === 'error' ||
            tc.status === 'cancelled') &&
            !(tc as TrackedCompletedToolCall | TrackedCancelledToolCall)
              .responseSubmittedToGemini),
      )
    ) {
      return StreamingState.Responding;
    }
    return StreamingState.Idle;
  }, [isResponding, toolCalls]);

  useInput((_input, key) => {
    if (streamingState === StreamingState.Responding && key.escape) {
      if (turnCancelledRef.current) {
        return;
      }
      turnCancelledRef.current = true;
      abortControllerRef.current?.abort();
      if (pendingHistoryItemRef.current) {
        addItem(pendingHistoryItemRef.current, Date.now());
      }
      addItem(
        {
          type: MessageType.INFO,
          text: 'Request cancelled.',
        },
        Date.now(),
      );
      setPendingHistoryItem(null);
      setIsResponding(false);
    }
  });

  const prepareQueryForGemini = useCallback(
    async (
      query: PartListUnion,
      userMessageTimestamp: number,
      abortSignal: AbortSignal,
    ): Promise<{
      queryToSend: PartListUnion | null;
      shouldProceed: boolean;
    }> => {
      if (turnCancelledRef.current) {
        return { queryToSend: null, shouldProceed: false };
      }
      if (typeof query === 'string' && query.trim().length === 0) {
        return { queryToSend: null, shouldProceed: false };
      }

      let localQueryToSendToGemini: PartListUnion | null = null;

      if (typeof query === 'string') {
        const trimmedQuery = query.trim();
        logUserPrompt(
          config,
          new UserPromptEvent(trimmedQuery.length, trimmedQuery),
        );
        onDebugMessage(`User query: '${trimmedQuery}'`);
        await logger?.logMessage(MessageSenderType.USER, trimmedQuery);

        // Handle UI-only commands first
        const slashCommandResult = await handleSlashCommand(trimmedQuery);
        if (typeof slashCommandResult === 'boolean' && slashCommandResult) {
          // Command was handled, and it doesn't require a tool call from here
          return { queryToSend: null, shouldProceed: false };
        } else if (
          typeof slashCommandResult === 'object' &&
          slashCommandResult.shouldScheduleTool
        ) {
          // Slash command wants to schedule a tool call (e.g., /memory add)
          const { toolName, toolArgs } = slashCommandResult;
          if (toolName && toolArgs) {
            const toolCallRequest: ToolCallRequestInfo = {
              callId: `${toolName}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
              name: toolName,
              args: toolArgs,
              isClientInitiated: true,
            };
            scheduleToolCalls([toolCallRequest], abortSignal);
          }
          return { queryToSend: null, shouldProceed: false }; // Handled by scheduling the tool
        }

        if (shellModeActive && handleShellCommand(trimmedQuery, abortSignal)) {
          return { queryToSend: null, shouldProceed: false };
        }

        // Handle @-commands (which might involve tool calls)
        if (isAtCommand(trimmedQuery)) {
          const atCommandResult = await handleAtCommand({
            query: trimmedQuery,
            config,
            addItem,
            onDebugMessage,
            messageId: userMessageTimestamp,
            signal: abortSignal,
          });
          if (!atCommandResult.shouldProceed) {
            return { queryToSend: null, shouldProceed: false };
          }
          localQueryToSendToGemini = atCommandResult.processedQuery;
        } else {
          // Normal query for Gemini
          addItem(
            { type: MessageType.USER, text: trimmedQuery },
            userMessageTimestamp,
          );
          localQueryToSendToGemini = trimmedQuery;
        }
      } else {
        // It's a function response (PartListUnion that isn't a string)
        localQueryToSendToGemini = query;
      }

      if (localQueryToSendToGemini === null) {
        onDebugMessage(
          'Query processing resulted in null, not sending to Gemini.',
        );
        return { queryToSend: null, shouldProceed: false };
      }
      return { queryToSend: localQueryToSendToGemini, shouldProceed: true };
    },
    [
      config,
      addItem,
      onDebugMessage,
      handleShellCommand,
      handleSlashCommand,
      logger,
      shellModeActive,
      scheduleToolCalls,
    ],
  );

  // --- Stream Event Handlers ---

  const handleContentEvent = useCallback(
    (
      eventValue: ContentEvent['value'],
      currentGeminiMessageBuffer: string,
      userMessageTimestamp: number,
    ): string => {
      if (turnCancelledRef.current) {
        // Prevents additional output after a user initiated cancel.
        return '';
      }
      let newGeminiMessageBuffer = currentGeminiMessageBuffer + eventValue;
      if (
        pendingHistoryItemRef.current?.type !== 'gemini' &&
        pendingHistoryItemRef.current?.type !== 'gemini_content'
      ) {
        if (pendingHistoryItemRef.current) {
          addItem(pendingHistoryItemRef.current, userMessageTimestamp);
        }
        setPendingHistoryItem({ type: 'gemini', text: '' });
        newGeminiMessageBuffer = eventValue;
      }
      // Split large messages for better rendering performance. Ideally,
      // we should maximize the amount of output sent to <Static />.
      const splitPoint = findLastSafeSplitPoint(newGeminiMessageBuffer);
      if (splitPoint === newGeminiMessageBuffer.length) {
        // Update the existing message with accumulated content
        setPendingHistoryItem((item) => ({
          type: item?.type as 'gemini' | 'gemini_content',
          text: newGeminiMessageBuffer,
        }));
      } else {
        // This indicates that we need to split up this Gemini Message.
        // Splitting a message is primarily a performance consideration. There is a
        // <Static> component at the root of App.tsx which takes care of rendering
        // content statically or dynamically. Everything but the last message is
        // treated as static in order to prevent re-rendering an entire message history
        // multiple times per-second (as streaming occurs). Prior to this change you'd
        // see heavy flickering of the terminal. This ensures that larger messages get
        // broken up so that there are more "statically" rendered.
        const beforeText = newGeminiMessageBuffer.substring(0, splitPoint);
        const afterText = newGeminiMessageBuffer.substring(splitPoint);
        addItem(
          {
            type: pendingHistoryItemRef.current?.type as
              | 'gemini'
              | 'gemini_content',
            text: beforeText,
          },
          userMessageTimestamp,
        );
        setPendingHistoryItem({ type: 'gemini_content', text: afterText });
        newGeminiMessageBuffer = afterText;
      }
      return newGeminiMessageBuffer;
    },
    [addItem, pendingHistoryItemRef, setPendingHistoryItem],
  );

  const handleUserCancelledEvent = useCallback(
    (userMessageTimestamp: number) => {
      if (turnCancelledRef.current) {
        return;
      }
      if (pendingHistoryItemRef.current) {
        if (pendingHistoryItemRef.current.type === 'tool_group') {
          const updatedTools = pendingHistoryItemRef.current.tools.map(
            (tool) =>
              tool.status === ToolCallStatus.Pending ||
              tool.status === ToolCallStatus.Confirming ||
              tool.status === ToolCallStatus.Executing
                ? { ...tool, status: ToolCallStatus.Canceled }
                : tool,
          );
          const pendingItem: HistoryItemToolGroup = {
            ...pendingHistoryItemRef.current,
            tools: updatedTools,
          };
          addItem(pendingItem, userMessageTimestamp);
        } else {
          addItem(pendingHistoryItemRef.current, userMessageTimestamp);
        }
        setPendingHistoryItem(null);
      }
      addItem(
        { type: MessageType.INFO, text: 'User cancelled the request.' },
        userMessageTimestamp,
      );
      setIsResponding(false);
    },
    [addItem, pendingHistoryItemRef, setPendingHistoryItem],
  );

  const handleErrorEvent = useCallback(
    (eventValue: ErrorEvent['value'], userMessageTimestamp: number) => {
      if (pendingHistoryItemRef.current) {
        addItem(pendingHistoryItemRef.current, userMessageTimestamp);
        setPendingHistoryItem(null);
      }
      addItem(
        {
          type: MessageType.ERROR,
          text: parseAndFormatApiError(
            eventValue.error,
            config.getContentGeneratorConfig().authType,
          ),
        },
        userMessageTimestamp,
      );
    },
    [addItem, pendingHistoryItemRef, setPendingHistoryItem, config],
  );

  const handleChatCompressionEvent = useCallback(
    (eventValue: ServerGeminiChatCompressedEvent['value']) =>
      addItem(
        {
          type: 'info',
          text:
            `IMPORTANT: This conversation approached the input token limit for ${config.getModel()}. ` +
            `A compressed context will be sent for future messages (compressed from: ` +
            `${eventValue?.originalTokenCount ?? 'unknown'} to ` +
            `${eventValue?.newTokenCount ?? 'unknown'} tokens).`,
        },
        Date.now(),
      ),
    [addItem, config],
  );

  const processGeminiStreamEvents = useCallback(
    async (
      stream: AsyncIterable<GeminiEvent>,
      userMessageTimestamp: number,
      signal: AbortSignal,
    ): Promise<StreamProcessingStatus> => {
      let geminiMessageBuffer = '';
      const toolCallRequests: ToolCallRequestInfo[] = [];
      
      onDebugMessage('processGeminiStreamEvents: Starting to process stream events');
      
      for await (const event of stream) {
        onDebugMessage(`processGeminiStreamEvents: Processing event type: ${event.type}`);
        
        switch (event.type) {
          case ServerGeminiEventType.Thought:
            setThought(event.value);
            break;
          case ServerGeminiEventType.Content:
            geminiMessageBuffer = handleContentEvent(
              event.value,
              geminiMessageBuffer,
              userMessageTimestamp,
            );
            break;
          case ServerGeminiEventType.ToolCallRequest:
            onDebugMessage(`processGeminiStreamEvents: Received tool call request: ${event.value.name}`);
            toolCallRequests.push(event.value);
            break;
          case ServerGeminiEventType.UserCancelled:
            handleUserCancelledEvent(userMessageTimestamp);
            break;
          case ServerGeminiEventType.Error:
            handleErrorEvent(event.value, userMessageTimestamp);
            break;
          case ServerGeminiEventType.ChatCompressed:
            handleChatCompressionEvent(event.value);
            break;
          case ServerGeminiEventType.ToolCallConfirmation:
          case ServerGeminiEventType.ToolCallResponse:
            // do nothing
            break;
          default: {
            // enforces exhaustive switch-case
            const unreachable: never = event;
            return unreachable;
          }
        }
      }
      
      onDebugMessage(`processGeminiStreamEvents: Stream processing completed, found ${toolCallRequests.length} tool calls`);
      
      if (toolCallRequests.length > 0) {
        onDebugMessage(`processGeminiStreamEvents: Scheduling ${toolCallRequests.length} tool calls`);
        scheduleToolCalls(toolCallRequests, signal);
      } else {
        onDebugMessage('processGeminiStreamEvents: No tool calls to schedule, stream processing complete');
      }
      return StreamProcessingStatus.Completed;
    },
    [
      handleContentEvent,
      handleUserCancelledEvent,
      handleErrorEvent,
      scheduleToolCalls,
      handleChatCompressionEvent,
      onDebugMessage,
    ],
  );

  const submitQuery = useCallback(
    async (query: PartListUnion, options?: { isContinuation: boolean }) => {
      onDebugMessage(`submitQuery called with isContinuation: ${options?.isContinuation}, streamingState: ${streamingState}`);
      
      // 严格的循环检测 - 防止重复调用
      if (isResponding) {
        onDebugMessage('submitQuery: Skipping because isResponding is true (already processing)');
        return;
      }
      
      if (
        (streamingState === StreamingState.Responding ||
          streamingState === StreamingState.WaitingForConfirmation) &&
        !options?.isContinuation
      ) {
        onDebugMessage('submitQuery: Skipping because streamingState is not idle and not continuation');
        return;
      }

      const userMessageTimestamp = Date.now();
      setShowHelp(false);

      abortControllerRef.current = new AbortController();
      const abortSignal = abortControllerRef.current.signal;
      turnCancelledRef.current = false;

      const { queryToSend, shouldProceed } = await prepareQueryForGemini(
        query,
        userMessageTimestamp,
        abortSignal,
      );

      if (!shouldProceed || queryToSend === null) {
        onDebugMessage('submitQuery: Query preparation resulted in no action needed');
        return;
      }

      setIsResponding(true);
      setInitError(null);

      try {
        const stream = geminiClient.sendMessageStream(queryToSend, abortSignal);
        const processingStatus = await processGeminiStreamEvents(
          stream,
          userMessageTimestamp,
          abortSignal,
        );

        if (processingStatus === StreamProcessingStatus.UserCancelled) {
          onDebugMessage('submitQuery: Processing was cancelled by user');
          return;
        }

        if (pendingHistoryItemRef.current) {
          addItem(pendingHistoryItemRef.current, userMessageTimestamp);
          setPendingHistoryItem(null);
        }
        
        onDebugMessage('submitQuery: Processing completed successfully');
      } catch (error: unknown) {
        if (error instanceof UnauthorizedError) {
          onDebugMessage('submitQuery: Unauthorized error, triggering auth error handler');
          onAuthError();
        } else if (!isNodeError(error) || error.name !== 'AbortError') {
          onDebugMessage(`submitQuery: Error occurred: ${getErrorMessage(error) || 'Unknown error'}`);
          addItem(
            {
              type: MessageType.ERROR,
              text: parseAndFormatApiError(
                getErrorMessage(error) || 'Unknown error',
                config.getContentGeneratorConfig().authType,
              ),
            },
            userMessageTimestamp,
          );
        }
      } finally {
        setIsResponding(false);
        onDebugMessage('submitQuery: Completed, isResponding set to false');
      }
    },
    [
      streamingState,
      setShowHelp,
      prepareQueryForGemini,
      processGeminiStreamEvents,
      pendingHistoryItemRef,
      addItem,
      setPendingHistoryItem,
      setInitError,
      geminiClient,
      onAuthError,
      config,
      onDebugMessage,
      isResponding,
    ],
  );

  const handleCompletedTools = useCallback(
    async (completedToolCallsFromScheduler: TrackedToolCall[]) => {
      const callStack = new Error().stack;
      onDebugMessage(`handleCompletedTools: Called from ${callStack?.split('\n')[2] || 'unknown'}`);
      onDebugMessage(`handleCompletedTools: Processing ${completedToolCallsFromScheduler.length} completed tools`);

      const completedAndReadyToSubmitTools =
        completedToolCallsFromScheduler.filter(
          (
            tc: TrackedToolCall,
          ): tc is TrackedCompletedToolCall | TrackedCancelledToolCall => {
            const isTerminalState =
              tc.status === 'success' ||
              tc.status === 'error' ||
              tc.status === 'cancelled';

            if (isTerminalState) {
              const completedOrCancelledCall = tc as
                | TrackedCompletedToolCall
                | TrackedCancelledToolCall;
              return (
                completedOrCancelledCall.response?.responseParts !== undefined
              );
            }
            return false;
          },
        );

      onDebugMessage(`handleCompletedTools: Found ${completedAndReadyToSubmitTools.length} completed tools`);

      // Finalize any client-initiated tools as soon as they are done.
      const clientTools = completedAndReadyToSubmitTools.filter(
        (t) => t.request.isClientInitiated,
      );
      if (clientTools.length > 0) {
        onDebugMessage(`handleCompletedTools: Processing ${clientTools.length} client-initiated tools`);
        markToolsAsSubmitted(clientTools.map((t) => t.request.callId));
      }

      // Identify new, successful save_memory calls that we haven't processed yet.
      const newSuccessfulMemorySaves = completedAndReadyToSubmitTools.filter(
        (t) =>
          t.request.name === 'save_memory' &&
          t.status === 'success' &&
          !processedMemoryToolsRef.current.has(t.request.callId),
      );

      if (newSuccessfulMemorySaves.length > 0) {
        onDebugMessage(`handleCompletedTools: Processing ${newSuccessfulMemorySaves.length} new memory saves`);
        void performMemoryRefresh();
        newSuccessfulMemorySaves.forEach((t) =>
          processedMemoryToolsRef.current.add(t.request.callId),
        );
      }

      const geminiTools = completedAndReadyToSubmitTools.filter(
        (t) => !t.request.isClientInitiated,
      );

      onDebugMessage(`handleCompletedTools: Found ${geminiTools.length} Gemini-initiated tools`);

      if (geminiTools.length === 0) {
        onDebugMessage('handleCompletedTools: No Gemini tools to process, returning');
        return;
      }

      // If all the tools were cancelled, don't submit a response to Gemini.
      const allToolsCancelled = geminiTools.every(
        (tc) => tc.status === 'cancelled',
      );

      if (allToolsCancelled) {
        onDebugMessage('handleCompletedTools: All tools were cancelled, not submitting response');
        if (geminiClient) {
          const responsesToAdd = geminiTools.flatMap(
            (toolCall) => toolCall.response.responseParts,
          );
          for (const response of responsesToAdd) {
            let parts: Part[];
            if (Array.isArray(response)) {
              parts = response;
            } else if (typeof response === 'string') {
              parts = [{ text: response }];
            } else {
              parts = [response];
            }
            geminiClient.addHistory({
              role: 'user',
              parts,
            });
          }
        }

        const callIdsToMarkAsSubmitted = geminiTools.map(
          (toolCall) => toolCall.request.callId,
        );
        markToolsAsSubmitted(callIdsToMarkAsSubmitted);
        return;
      }

      // 防止死循环：只处理包含纯文本内容的工具响应
      const responsesToSend: PartListUnion[] = [];
      for (const toolCall of geminiTools) {
        const responseParts = toolCall.response.responseParts;
        if (Array.isArray(responseParts)) {
          // 检查是否包含纯文本内容
          const hasTextContent = responseParts.some(part => {
            if (typeof part === 'string') return true;
            if (part && typeof part === 'object' && 'text' in part) return true;
            return false;
          });
          if (hasTextContent) {
            responsesToSend.push(responseParts);
          }
        } else if (typeof responseParts === 'string') {
          responsesToSend.push(responseParts);
        } else if (responseParts && typeof responseParts === 'object' && 'text' in responseParts) {
          responsesToSend.push(responseParts);
        }
      }

      const callIdsToMarkAsSubmitted = geminiTools.map(
        (toolCall) => toolCall.request.callId,
      );

      onDebugMessage(`handleCompletedTools: Found ${responsesToSend.length} tool responses with text content to submit`);

      markToolsAsSubmitted(callIdsToMarkAsSubmitted);
      
      // 只有在有文本内容时才提交给模型，避免死循环
      if (responsesToSend.length > 0) {
        submitQuery(mergePartListUnions(responsesToSend), {
          isContinuation: true,
        });
      } else {
        onDebugMessage('handleCompletedTools: No text content in tool responses, not submitting to avoid loop');
      }
    },
    [
      isResponding,
      submitQuery,
      markToolsAsSubmitted,
      geminiClient,
      performMemoryRefresh,
      onDebugMessage,
    ],
  );

  const pendingHistoryItems = [
    pendingHistoryItemRef.current,
    pendingToolCallGroupDisplay,
  ].filter((i) => i !== undefined && i !== null);

  useEffect(() => {
    const saveRestorableToolCalls = async () => {
      if (!config.getCheckpointingEnabled()) {
        return;
      }
      const restorableToolCalls = toolCalls.filter(
        (toolCall) =>
          (toolCall.request.name === 'replace' ||
            toolCall.request.name === 'write_file') &&
          toolCall.status === 'awaiting_approval',
      );

      if (restorableToolCalls.length > 0) {
        const checkpointDir = config.getProjectTempDir()
          ? path.join(config.getProjectTempDir(), 'checkpoints')
          : undefined;

        if (!checkpointDir) {
          return;
        }

        try {
          await fs.mkdir(checkpointDir, { recursive: true });
        } catch (error) {
          if (!isNodeError(error) || error.code !== 'EEXIST') {
            onDebugMessage(
              `Failed to create checkpoint directory: ${getErrorMessage(error)}`,
            );
            return;
          }
        }

        for (const toolCall of restorableToolCalls) {
          const filePath = toolCall.request.args['file_path'] as string;
          if (!filePath) {
            onDebugMessage(
              `Skipping restorable tool call due to missing file_path: ${toolCall.request.name}`,
            );
            continue;
          }

          try {
            let commitHash = await gitService?.createFileSnapshot(
              `Snapshot for ${toolCall.request.name}`,
            );

            if (!commitHash) {
              commitHash = await gitService?.getCurrentCommitHash();
            }

            if (!commitHash) {
              onDebugMessage(
                `Failed to create snapshot for ${filePath}. Skipping restorable tool call.`,
              );
              continue;
            }

            const timestamp = new Date()
              .toISOString()
              .replace(/:/g, '-')
              .replace(/\./g, '_');
            const toolName = toolCall.request.name;
            const fileName = path.basename(filePath);
            const toolCallWithSnapshotFileName = `${timestamp}-${fileName}-${toolName}.json`;
            const clientHistory = await geminiClient?.getHistory();
            const toolCallWithSnapshotFilePath = path.join(
              checkpointDir,
              toolCallWithSnapshotFileName,
            );

            await fs.writeFile(
              toolCallWithSnapshotFilePath,
              JSON.stringify(
                {
                  history,
                  clientHistory,
                  toolCall: {
                    name: toolCall.request.name,
                    args: toolCall.request.args,
                  },
                  commitHash,
                  filePath,
                },
                null,
                2,
              ),
            );
          } catch (error) {
            onDebugMessage(
              `Failed to write restorable tool call file: ${getErrorMessage(
                error,
              )}`,
            );
          }
        }
      }
    };
    saveRestorableToolCalls();
  }, [toolCalls, config, onDebugMessage, gitService, history, geminiClient]);

  return {
    streamingState,
    submitQuery,
    initError,
    pendingHistoryItems,
    thought,
  };
};
