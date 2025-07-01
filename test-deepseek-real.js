#!/usr/bin/env node

// 测试真正的Deepseek API集成
const { spawn } = require('child_process');

async function testDeepseek() {
  console.log('🧪 测试真正的Deepseek API集成...\n');

  // 检查是否有API密钥
  if (!process.env.DEEPSEEK_API_KEY) {
    console.log('❌ 请设置 DEEPSEEK_API_KEY 环境变量');
    console.log('   例如: export DEEPSEEK_API_KEY="your-api-key-here"');
    return;
  }

  console.log('✅ 找到 DEEPSEEK_API_KEY');
  console.log('🚀 启动Deepseek测试...\n');

  // 运行CLI命令
  const child = spawn('node', [
    'packages/cli/dist/index.js',
    '--provider', 'deepseek',
    '--model', 'deepseek-chat',
    '--prompt', '请用中文简单介绍一下你自己'
  ], {
    stdio: 'inherit',
    env: {
      ...process.env,
      GEMINI_PROVIDER: 'deepseek'
    }
  });

  child.on('close', (code) => {
    console.log(`\n📊 测试完成，退出码: ${code}`);
    if (code === 0) {
      console.log('✅ Deepseek API集成测试成功！');
    } else {
      console.log('❌ Deepseek API集成测试失败');
    }
  });

  child.on('error', (error) => {
    console.error('❌ 启动测试失败:', error.message);
  });
}

testDeepseek().catch(console.error); 