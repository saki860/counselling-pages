// @ts-check
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  analyzeNeeds,
  analyzeRiskLevel,
  buildFullChatPrompt,
  buildSummaryPrompt,
  errorStatus,
  extractTextFromGeminiPayload,
  formatApiErrors,
  formatSummaryFileTimestamp,
  generateAiResponseGemini,
  generateConversationSummary,
  generateSystemPrompt,
} from '../core.js';

/**
 * テスト用のモックfetchを生成するヘルパー
 * @param {readonly (string | Error | { status: number; body?: unknown })[]} outcomes
 * @returns {typeof fetch}
 */
const createMockFetch = (outcomes) => {
  let index = 0;
  return async () => {
    const current = outcomes[index];
    index += 1;
    if (current instanceof Error) {
      throw current;
    }
    if (typeof current === 'string') {
      return /** @type {Response} */ (
        /** @type {unknown} */ ({
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: current }] } }],
          }),
        })
      );
    }
    if (typeof current === 'object' && current !== null && 'status' in current) {
      const isOk = current.status >= 200 && current.status < 300;
      return /** @type {Response} */ (
        /** @type {unknown} */ ({
          ok: isOk,
          status: current.status,
          json: async () => current.body ?? {},
        })
      );
    }
    throw new Error('Unexpected mock outcome');
  };
};

test('quota is not hidden by later missing model', async () => {
  const fetchImpl = createMockFetch([
    new Error('429 quota exhausted'),
    new Error('404 model not found'),
  ]);
  const result = await generateAiResponseGemini({
    userMessage: 'hello',
    riskLevel: 1,
    needsType: 'listening',
    chatHistory: [],
    apiKey: 'secret-key',
    chatMode: 'listening',
    fetchImpl,
  });
  assert.match(result, /利用上限/);
  assert.match(result, /429/);
  assert.match(result, /404/);
});

test('successful fallback returns answer', async () => {
  const fetchImpl = createMockFetch([new Error('503 unavailable'), 'answer']);
  const result = await generateAiResponseGemini({
    userMessage: 'hello',
    riskLevel: 1,
    needsType: 'listening',
    chatHistory: [],
    apiKey: 'secret-key',
    chatMode: 'listening',
    fetchImpl,
  });
  assert.equal(result, 'answer');
});

test('first model success', async () => {
  const fetchImpl = createMockFetch(['answer']);
  const result = await generateAiResponseGemini({
    userMessage: 'hello',
    riskLevel: 1,
    needsType: 'listening',
    chatHistory: [],
    apiKey: 'secret-key',
    chatMode: 'listening',
    fetchImpl,
  });
  assert.equal(result, 'answer');
});

test('credentials and request text are not exposed', async () => {
  const error = new Error('403 secret-key private consultation');
  const fetchImpl = createMockFetch([error, error]);
  const result = await generateAiResponseGemini({
    userMessage: 'private consultation',
    riskLevel: 1,
    needsType: 'listening',
    chatHistory: [],
    apiKey: 'secret-key',
    chatMode: 'listening',
    fetchImpl,
  });
  assert.match(result, /APIキー/);
  assert.match(result, /403/);
  assert.ok(!result.includes('secret-key'));
  assert.ok(!result.includes('private consultation'));
});

test('summary diagnostics are safe', async () => {
  const fetchImpl = createMockFetch([
    new Error('429 secret-key private consultation'),
  ]);
  const result = await generateConversationSummary({
    chatHistory: [],
    apiKey: 'secret-key',
    fetchImpl,
  });
  assert.match(result, /利用上限/);
  assert.ok(!result.includes('secret-key'));
  assert.ok(!result.includes('private consultation'));
});

test('unknown error has no raw exception text', async () => {
  const error = new Error('private consultation');
  const fetchImpl = createMockFetch([error, error]);
  const result = await generateAiResponseGemini({
    userMessage: 'private consultation',
    riskLevel: 1,
    needsType: 'listening',
    chatHistory: [],
    apiKey: 'secret-key',
    chatMode: 'listening',
    fetchImpl,
  });
  assert.match(result, /不明/);
  assert.ok(!result.includes('private consultation'));
});

test('sdk or http status property is used', async () => {
  const quotaError = Object.assign(new Error('no status in message'), {
    code: 429,
  });
  const fetchImpl = createMockFetch([quotaError, quotaError]);
  const result = await generateAiResponseGemini({
    userMessage: 'hello',
    riskLevel: 1,
    needsType: 'listening',
    chatHistory: [],
    apiKey: 'secret-key',
    chatMode: 'listening',
    fetchImpl,
  });
  assert.match(result, /利用上限/);
  assert.equal(errorStatus(quotaError), '429');
});

test('analyzeRiskLevel detects weighted risk levels accurately', () => {
  const highRisk = analyzeRiskLevel('もう限界で消えたいと思っています');
  assert.equal(highRisk.riskLevel, 4);
  assert.ok(highRisk.detectedKeywords.includes('限界'));
  assert.ok(highRisk.detectedKeywords.includes('消えたい'));

  const criticalRisk = analyzeRiskLevel('死にたいくらい自殺を考えている');
  assert.equal(criticalRisk.riskLevel, 5);

  const defaultRisk = analyzeRiskLevel('こんにちは');
  assert.equal(defaultRisk.riskLevel, 1);
  assert.deepEqual(defaultRisk.detectedKeywords, []);
});

test('analyzeNeeds identifies listening, solution, and thinking needs', () => {
  assert.equal(analyzeNeeds('ただ話を聞いてほしいです'), 'listening');
  assert.equal(analyzeNeeds('どうすれば解決できるか方法を教えて'), 'solution');
  assert.equal(analyzeNeeds('進路について一緒に考えたい'), 'thinking');
  assert.equal(analyzeNeeds('特になし'), 'listening');
});

test('generateSystemPrompt and prompt builders include mode, risk, and needs sections', () => {
  const prompt = generateSystemPrompt(5, 'solution', 'solution');
  assert.match(prompt, /【モード: 解決策提案モード】/);
  assert.match(prompt, /【緊急対応モード】/);
  assert.match(prompt, /【ニーズ: 解決策提示】/);

  const fullPrompt = buildFullChatPrompt(
    'テスト相談',
    3,
    'listening',
    [{ role: 'user', content: '前回の発言', timestamp: '2026-10-23T00:00:00Z' }],
    'listening'
  );
  assert.match(fullPrompt, /相談者: 前回の発言/);
  assert.match(fullPrompt, /相談者: テスト相談/);

  const summaryPrompt = buildSummaryPrompt([
    { role: 'user', content: '相談内容A', timestamp: '2026-10-23T00:00:00Z' },
    { role: 'assistant', content: '応答内容B', timestamp: '2026-10-23T00:00:01Z' },
  ]);
  assert.match(summaryPrompt, /相談者: 相談内容A/);
  assert.match(summaryPrompt, /サポーター: 応答内容B/);
});

test('extractTextFromGeminiPayload and formatSummaryFileTimestamp', () => {
  assert.equal(extractTextFromGeminiPayload(null), null);
  assert.equal(
    extractTextFromGeminiPayload({
      candidates: [{ content: { parts: [{ text: 'こんにちは' }] } }],
    }),
    'こんにちは'
  );
  const sampleDate = new Date(2026, 9, 23, 15, 4, 9);
  assert.equal(formatSummaryFileTimestamp(sampleDate), '20261023_150409');
  assert.match(
    formatApiErrors([{ model: 'test-model', error: new Error('500 error') }]),
    /一時的な障害/
  );
});
