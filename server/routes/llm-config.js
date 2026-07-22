const express = require('express');
const router = express.Router();
const fs = require('fs');
const { migrateLegacyFile } = require('../services/runtime-paths');
const { encrypt, decrypt } = require('../services/llm-config-crypto');

const CONFIG_FILE = migrateLegacyFile('.llm-config.json');

// 保存 LLM 配置
router.post('/save', async (req, res) => {
  try {
    const { provider, endpoint, model, apiKey } = req.body;

    if (!provider) {
      return res.status(400).json({ error: 'Missing provider' });
    }

    // Ollama 不需要 API 密钥
    const config = {
      provider,
      endpoint: endpoint || null,
      model: model || null,
      disabled: false
    };

    // 只有非 Ollama 才加密 API 密钥；未传入时保留已有密钥，避免加载掩码后保存丢失配置
    if (provider !== 'ollama') {
      if (apiKey) {
        config.apiKey = encrypt(apiKey);
      } else if (fs.existsSync(CONFIG_FILE)) {
        const existing = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        if (existing.provider === provider && existing.apiKey) {
          config.apiKey = encrypt(decrypt(existing.apiKey));
        } else {
          return res.status(400).json({ error: 'Missing API key' });
        }
      } else {
        return res.status(400).json({ error: 'Missing API key' });
      }
    }

    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    try {
      require('../services/ai-adapter').loadConfig();
    } catch (reloadError) {
      console.warn('[Config] Saved, but AI adapter reload failed:', reloadError.message);
    }

    res.json({ success: true, message: 'Configuration saved' });
  } catch (error) {
    console.error('[Config] Save error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 加载 LLM 配置
router.get('/load', async (req, res) => {
  try {
    if (!fs.existsSync(CONFIG_FILE)) {
      return res.json({ configured: false });
    }

    const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));

    // 解密 API 密钥（仅返回前几位）。ollama 等无密钥 provider 不写入 apiKey
    let maskedKey = null;
    let warning = null;
    if (config.apiKey) {
      try {
        maskedKey = maskApiKey(decrypt(config.apiKey));
      } catch (decryptError) {
        warning = 'Saved API key could not be decrypted. Please re-enter and save it.';
      }
    }

    res.json({
      configured: true,
      disabled: config.disabled === true,
      provider: config.provider,
      endpoint: config.endpoint,
      model: config.model,
      apiKey: maskedKey,
      warning
    });
  } catch (error) {
    console.error('[Config] Load error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 手动断开 LLM：保留配置但让 AI adapter 切回本地匹配模式
router.post('/disconnect', async (req, res) => {
  try {
    if (!fs.existsSync(CONFIG_FILE)) {
      return res.json({ success: true, configured: false, disabled: true });
    }

    const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    config.disabled = true;
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    try {
      require('../services/ai-adapter').loadConfig();
    } catch (reloadError) {
      console.warn('[Config] Disconnected, but AI adapter reload failed:', reloadError.message);
    }

    res.json({ success: true, configured: true, disabled: true });
  } catch (error) {
    console.error('[Config] Disconnect error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 手动恢复 LLM：启用已保存配置，随后由前端触发 test 确认可用性
router.post('/connect', async (req, res) => {
  try {
    if (!fs.existsSync(CONFIG_FILE)) {
      return res.status(400).json({ success: false, error: 'No configuration found' });
    }

    const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    config.disabled = false;
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    try {
      require('../services/ai-adapter').loadConfig();
    } catch (reloadError) {
      console.warn('[Config] Connected, but AI adapter reload failed:', reloadError.message);
    }

    res.json({ success: true, configured: true, disabled: false });
  } catch (error) {
    console.error('[Config] Connect error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 测试连接
router.post('/test', async (req, res) => {
  try {
    if (!fs.existsSync(CONFIG_FILE)) {
      return res.json({ success: false, error: 'No configuration found' });
    }

    const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    if (config.disabled === true) {
      return res.json({ success: false, disabled: true, error: 'LLM provider is manually disconnected' });
    }
    if (config.apiKey) config.apiKey = decrypt(config.apiKey);
    else delete config.apiKey;

    // 轻量 ping 测试：直接发最小请求验证 endpoint + key + model 可用
    // 不再调用 generatePlan（依赖完整 prompt + JSON 解析，解析失败会被误判为连接失败）
    const axios = require('axios');
    const LLMAdapter = require('../services/llm-adapter');
    const { normalizeOpenAiEndpoint, normalizeAnthropicEndpoint } = LLMAdapter;

    const provider = config.provider;
    const model = config.model || '';
    const apiKey = config.apiKey || '';
    const timeout = 20000;

    let testUrl;
    let testHeaders;
    let testBody;

    if (provider === 'anthropic') {
      testUrl = normalizeAnthropicEndpoint(config.endpoint);
      testHeaders = {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      };
      testBody = {
        model: model || 'claude-3-5-sonnet-20241022',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }]
      };
    } else if (provider === 'ollama') {
      // Ollama 用 /api/tags 验证（无需 model/key）
      const ollamaBase = (config.endpoint || 'http://localhost:11434').replace(/\/+$/, '');
      try {
        const tagsRes = await axios.get(`${ollamaBase}/api/tags`, { timeout });
        const modelCount = Array.isArray(tagsRes.data?.models) ? tagsRes.data.models.length : 0;
        return res.json({
          success: true,
          message: `Connection successful (Ollama, ${modelCount} models available)`
        });
      } catch (err) {
        return res.json({
          success: false,
          error: formatAxiosError(err, `${ollamaBase}/api/tags`, 'Ollama endpoint unreachable')
        });
      }
    } else {
      // OpenAI 兼容（openai / deepseek / custom）
      testUrl = normalizeOpenAiEndpoint(config.endpoint, provider);
      testHeaders = {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      };
      testBody = {
        model: model || 'gpt-4',
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1
      };
    }

    try {
      await axios.post(testUrl, testBody, { headers: testHeaders, timeout });
      return res.json({
        success: true,
        message: `Connection successful (${provider} @ ${shortenUrl(testUrl)})`
      });
    } catch (err) {
      return res.json({
        success: false,
        error: formatAxiosError(err, testUrl, getEndpointHint(provider))
      });
    }
  } catch (error) {
    console.error('[Config] Test error:', error);
    res.json({ success: false, error: error.message });
  }
});

// 把 axios 错误转换为可读字符串，包含 status / 实际 URL / 响应体 / 提示
function formatAxiosError(err, requestedUrl, hint) {
  if (err.response) {
    const status = err.response.status;
    const statusText = err.response.statusText || '';
    let respBody = '';
    try {
      const data = err.response.data;
      if (typeof data === 'string') respBody = data;
      else if (data && typeof data === 'object') {
        // OpenAI/DeepSeek 错误通常在 data.error.message
        if (data.error?.message) respBody = JSON.stringify(data.error);
        else respBody = JSON.stringify(data);
      }
    } catch (_) { /* ignore */ }
    if (respBody && respBody.length > 400) respBody = respBody.slice(0, 400) + '...';
    let msg = `HTTP ${status}${statusText ? ' ' + statusText : ''} at ${shortenUrl(requestedUrl)}`;
    if (respBody) msg += `\nResponse: ${respBody}`;
    if (hint) msg += `\nHint: ${hint}`;
    return msg;
  }
  if (err.request) {
    let msg = `No response from ${shortenUrl(requestedUrl)} (${err.code || err.message})`;
    if (hint) msg += `\nHint: ${hint}`;
    return msg;
  }
  return err.message || 'Unknown error';
}

function shortenUrl(url) {
  // 隐藏 apiKey（如果出现在 query 中），其余保留
  return String(url || '').replace(/([?&]key=)[^&]+/, '$1***');
}

function getEndpointHint(provider) {
  if (provider === 'anthropic') {
    return 'Anthropic endpoint should be like https://api.anthropic.com/v1/messages';
  }
  if (provider === 'deepseek') {
    return 'DeepSeek endpoint should be like https://api.deepseek.com (server auto-appends /v1/chat/completions); model should be deepseek-chat or deepseek-reasoner';
  }
  if (provider === 'openai') {
    return 'OpenAI endpoint should be like https://api.openai.com (server auto-appends /v1/chat/completions); model should be like gpt-4o / gpt-4-turbo';
  }
  return 'Custom OpenAI-compatible endpoint; server auto-appends /v1/chat/completions if missing';
}

// 掩码 API 密钥
function maskApiKey(key) {
  if (key.length <= 8) return '***';
  return key.substring(0, 8) + '...' + key.substring(key.length - 4);
}

module.exports = router;
