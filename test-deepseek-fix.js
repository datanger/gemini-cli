#!/usr/bin/env node

/**
 * 测试 DeepseekAdapter 修复的脚本
 */

// 设置环境变量
process.env.GEMINI_PROVIDER = 'deepseek';
process.env.DEEPSEEK_API_KEY = 'test-key';

// 模拟 createContentGenerator 的逻辑
async function testCreateContentGenerator() {
  const provider = process.env.GEMINI_PROVIDER || 'gemini';
  
  console.log(`🔍 Debug: Provider = ${provider}, GEMINI_PROVIDER = ${process.env.GEMINI_PROVIDER}`);

  if (provider === 'deepseek') {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    console.log(`🔍 Debug: DEEPSEEK_API_KEY = ${apiKey ? 'SET' : 'NOT SET'}`);
    if (!apiKey) {
      throw new Error('DEEPSEEK_API_KEY environment variable is required for Deepseek provider');
    }
    console.log('🔍 Debug: Using real Deepseek adapter');
    return 'DeepseekAdapter';
  }

  if (provider !== 'gemini' && provider !== 'deepseek') {
    console.log('🔍 Debug: Using mock adapter');
    return 'MockAdapter';
  }

  console.log('🔍 Debug: Using Gemini adapter');
  return 'GeminiAdapter';
}

// 运行测试
async function runTest() {
  try {
    const result = await testCreateContentGenerator();
    console.log(`✅ Result: ${result}`);
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
  }
}

runTest(); 
