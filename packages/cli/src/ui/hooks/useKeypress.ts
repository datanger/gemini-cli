/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef } from 'react';
import { useStdin } from 'ink';
import readline from 'readline';

export interface Key {
  name: string;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  paste: boolean;
  sequence: string;
}

/**
 * A hook that listens for keypress events from stdin, providing a
 * key object that mirrors the one from Node's `readline` module,
 * adding a 'paste' flag for characters input as part of a bracketed
 * paste (when enabled).
 *
 * Pastes are currently sent as a single key event where the full paste
 * is in the sequence field.
 *
 * @param onKeypress - The callback function to execute on each keypress.
 * @param options - Options to control the hook's behavior.
 * @param options.isActive - Whether the hook should be actively listening for input.
 */
export function useKeypress(
  onKeypress: (key: Key) => void,
  { isActive }: { isActive: boolean },
) {
  const { stdin, setRawMode } = useStdin();
  const onKeypressRef = useRef(onKeypress);

  useEffect(() => {
    onKeypressRef.current = onKeypress;
  }, [onKeypress]);

  useEffect(() => {
    if (!isActive || !stdin.isTTY) {
      return;
    }

    setRawMode(true);

    const rl = readline.createInterface({ input: stdin });
    let isPaste = false;
    let pasteBuffer = Buffer.alloc(0);

    // --- 多字节字符缓冲 ---
    let charBuffer = Buffer.alloc(0);
    let charTimeout: NodeJS.Timeout | null = null;

    const handleKeypress = (_: unknown, key: Key) => {
      // 处理 paste 事件
      if (key.name === 'paste-start') {
        isPaste = true;
        return;
      } else if (key.name === 'paste-end') {
        isPaste = false;
        onKeypressRef.current({
          name: '',
          ctrl: false,
          meta: false,
          shift: false,
          paste: true,
          sequence: pasteBuffer.toString(),
        });
        pasteBuffer = Buffer.alloc(0);
        return;
      }

      if (isPaste) {
        pasteBuffer = Buffer.concat([pasteBuffer, Buffer.from(key.sequence)]);
        return;
      }

      // 处理特殊键（如 return）
      if (key.name === 'return' && key.sequence === '\x1B\r') {
        key.meta = true;
      }

      // 只缓冲普通字符（无特殊键）
      if (!key.name && !key.ctrl && !key.meta && key.sequence) {
        charBuffer = Buffer.concat([charBuffer, Buffer.from(key.sequence)]);
        if (charTimeout) clearTimeout(charTimeout);
        charTimeout = setTimeout(() => {
          if (charBuffer.length > 0) {
            try {
              const str = charBuffer.toString('utf8');
              onKeypressRef.current({
                ...key,
                sequence: str,
              });
            } catch {
              // fallback: 逐字节
              for (let i = 0; i < charBuffer.length; i++) {
                onKeypressRef.current({
                  ...key,
                  sequence: String.fromCharCode(charBuffer[i]),
                });
              }
            }
            charBuffer = Buffer.alloc(0);
          }
        }, 10); // 10ms 组装窗口
        return;
      }

      // 其他特殊键，立即处理并清空缓冲
      if (charTimeout) {
        clearTimeout(charTimeout);
        charTimeout = null;
      }
      
      if (charBuffer.length > 0) {
        try {
          const str = charBuffer.toString('utf8');
          onKeypressRef.current({
            ...key,
            sequence: str,
          });
        } catch {
          for (let i = 0; i < charBuffer.length; i++) {
            onKeypressRef.current({
              ...key,
              sequence: String.fromCharCode(charBuffer[i]),
            });
          }
        }
        charBuffer = Buffer.alloc(0);
      }
      
      onKeypressRef.current(key);
    };

    readline.emitKeypressEvents(stdin, rl);
    stdin.on('keypress', handleKeypress);

    return () => {
      stdin.removeListener('keypress', handleKeypress);
      rl.close();
      setRawMode(false);
      
      if (charTimeout) {
        clearTimeout(charTimeout);
      }
      
      // 处理剩余的缓冲字符
      if (charBuffer.length > 0) {
        try {
          const str = charBuffer.toString('utf8');
          onKeypressRef.current({
            name: '',
            ctrl: false,
            meta: false,
            shift: false,
            paste: false,
            sequence: str,
          });
        } catch {
          for (let i = 0; i < charBuffer.length; i++) {
            onKeypressRef.current({
              name: '',
              ctrl: false,
              meta: false,
              shift: false,
              paste: false,
              sequence: String.fromCharCode(charBuffer[i]),
            });
          }
        }
        charBuffer = Buffer.alloc(0);
      }
      
      // 处理剩余的 paste 缓冲
      if (isPaste && pasteBuffer.length > 0) {
        onKeypressRef.current({
          name: '',
          ctrl: false,
          meta: false,
          shift: false,
          paste: true,
          sequence: pasteBuffer.toString(),
        });
        pasteBuffer = Buffer.alloc(0);
      }
    };
  }, [isActive, stdin, setRawMode]);
}
