// @ts-check

/**
 * @typedef {'listening' | 'solution' | 'thinking'} NeedsType
 * @typedef {'listening' | 'solution'} ChatMode
 * @typedef {1 | 2 | 3 | 4 | 5} RiskLevel
 *
 * @typedef {Object} ChatMessage
 * @property {'user' | 'assistant'} role
 * @property {string} content
 * @property {string} timestamp
 * @property {RiskLevel} [riskLevel]
 * @property {NeedsType} [needsType]
 * @property {readonly string[]} [detectedKeywords]
 *
 * @typedef {Object} ModelErrorEntry
 * @property {string} model
 * @property {unknown} error
 */

/** @type {Readonly<Record<RiskLevel, { readonly keywords: readonly string[]; readonly weight: number }>>} */
export const RISK_KEYWORDS = Object.freeze({
  5: Object.freeze({
    keywords: Object.freeze([
      '死にたい', '自殺', '消えたい', '生きる意味', '死のう',
      '飛び降り', '首を', 'リストカット', '薬を大量に',
    ]),
    weight: 10,
  }),
  4: Object.freeze({
    keywords: Object.freeze([
      '誰も信じられない', '絶望', '助けて', '限界', '耐えられない',
      '居場所がない', '孤独', '消えたい', '不登校', '行けない',
    ]),
    weight: 7,
  }),
  3: Object.freeze({
    keywords: Object.freeze([
      '辛い', 'しんどい', '苦しい', 'ストレス', '眠れない',
      '食欲がない', '疲れた', '不安', '心配', 'プレッシャー',
    ]),
    weight: 4,
  }),
  2: Object.freeze({
    keywords: Object.freeze([
      '悩み', '困っている', 'どうしよう', '迷っている',
      '友達', '勉強', '進路', '部活', '先生',
    ]),
    weight: 2,
  }),
  1: Object.freeze({
    keywords: Object.freeze(['相談', '聞いて', '話したい', 'アドバイス']),
    weight: 1,
  }),
});

/** @type {Readonly<Record<NeedsType, readonly string[]>>} */
export const NEEDS_KEYWORDS = Object.freeze({
  listening: Object.freeze([
    '聞いてほしい', '話を聞いて', '誰かに話したい', '吐き出したい',
    'わかってほしい', '共感', '理解してほしい',
  ]),
  solution: Object.freeze([
    'どうすれば', '解決', '方法', 'アドバイス', '改善',
    '対策', 'やり方', '教えて',
  ]),
  thinking: Object.freeze([
    'どう思う', '考えたい', '一緒に', '選択', '決断',
    '進路', 'どちらが', '迷っている',
  ]),
});

/** @type {readonly RiskLevel[]} */
const RISK_LEVEL_ORDER = Object.freeze([5, 4, 3, 2, 1]);

/** @type {readonly RiskLevel[]} */
const RISK_SCORE_EVAL_ORDER = Object.freeze([1, 2, 3, 4, 5]);

/** @type {readonly NeedsType[]} */
const NEEDS_ORDER = Object.freeze(['listening', 'solution', 'thinking']);

export const CHAT_MODELS = Object.freeze([
  'gemini-3.5-flash-lite',
  'gemini-2.5-flash',
]);

export const SUMMARY_MODEL = 'gemini-3.5-flash-lite';

/**
 * 相談内容からリスクレベルと検出キーワードを判定する純粋関数
 * @param {string} text
 * @returns {{ readonly riskLevel: RiskLevel; readonly detectedKeywords: readonly string[] }}
 */
export const analyzeRiskLevel = (text) => {
  const textLower = text.toLowerCase();
  /** @type {string[]} */
  const detectedKeywords = [];
  /** @type {Record<RiskLevel, number>} */
  const riskScores = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

  for (const level of RISK_LEVEL_ORDER) {
    const data = RISK_KEYWORDS[level];
    for (const keyword of data.keywords) {
      if (textLower.includes(keyword)) {
        riskScores[level] += data.weight;
        detectedKeywords.push(keyword);
      }
    }
  }

  /** @type {RiskLevel} */
  let maxLevel = 1;
  let maxScore = 0;
  for (const level of RISK_SCORE_EVAL_ORDER) {
    const score = riskScores[level];
    if (score > maxScore) {
      maxScore = score;
      maxLevel = level;
    }
  }

  return Object.freeze({
    riskLevel: maxLevel,
    detectedKeywords: Object.freeze(detectedKeywords),
  });
};

/**
 * 相談者のニーズを分析する純粋関数
 * @param {string} text
 * @returns {NeedsType}
 */
export const analyzeNeeds = (text) => {
  const textLower = text.toLowerCase();
  /** @type {Record<NeedsType, number>} */
  const needsScores = { listening: 0, solution: 0, thinking: 0 };

  for (const needType of NEEDS_ORDER) {
    for (const keyword of NEEDS_KEYWORDS[needType]) {
      if (textLower.includes(keyword)) {
        needsScores[needType] += 1;
      }
    }
  }

  const maxScore = Math.max(
    needsScores.listening,
    needsScores.solution,
    needsScores.thinking
  );
  if (maxScore === 0) {
    return 'listening';
  }

  for (const needType of NEEDS_ORDER) {
    if (needsScores[needType] === maxScore) {
      return needType;
    }
  }
  return 'listening';
};

const BASE_GUARDRAILS = `
あなたは学生向けの相談支援員として会話してください。以下のガードレールを厳守してください:
- 自分を「AI」や「人工知能」と名乗ったり説明したりしない
- 医療的診断や治療の提供は行わない
- 違法行為や危険行為を推奨しない
- 個人情報の収集や保存を求めない
- 常に相談者の安全を最優先する
- 応答は簡潔で温かみのあるトーンで、200文字程度を目安にする
- ②応答のバリエーションを豊かにする:
  * 同じような言い回しや定型文を繰り返さない
  * 相談内容に合わせて言葉を変える（口語的、やわらかい表現、問いかけなど）
  * 「そうなんですね」「それは大変でしたね」などを毎回使わず、多様な受け答えをする
  * ときに短く簡潔に、ときに具体的に、応答の長さにも緩急をつける
`;

/** @type {Readonly<Record<ChatMode, string>>} */
const MODE_PROMPTS = Object.freeze({
  listening: `
【モード: 傾聴モード】
今は「聞く」ことを最優先にしてください。
- アドバイスや解決策は基本的に控える
- 相談者の気持ちを受け止め、共感を示す
- 質問するときも、詰問にならないよう1つだけ、やさしく聞く
- 「頑張れ」などの励ましより、「そういう気持ちになるのは自然なことだよ」など、気持ちに寄り添う言葉を選ぶ
`,
  solution: `
【モード: 解決策提案モード】
相談者が具体的に前進できるよう、実践的なサポートをしてください。
- 状況を整理しながら、具体的な選択肢や行動案を提示する
- 押しつけにならず「こういう方法もあるよ」という提案スタイルにする
- 複数の選択肢を示し、最終判断は相談者に委ねる
- 小さな一歩から始められる現実的なアドバイスを心がける
`,
});

/** @type {Readonly<Record<RiskLevel, string>>} */
const RISK_PROMPTS = Object.freeze({
  5: `
【緊急対応モード】
相談者は深刻な危機状態にあります。以下を実施してください:
1. 相談者の気持ちを否定せず、傾聴する
2. 生きる価値があることを穏やかに伝える
3. 必ず専門家への相談を強く推奨する
4. 学校のカウンセラー、保健室、信頼できる大人への相談を促す
5. 必要に応じて、いのちの電話(0120-783-556)などの緊急連絡先を案内する
`,
  4: `
【高リスク対応モード】
相談者は高いストレス状態にあります:
1. 丁寧に傾聴し、相談者の気持ちを受け止める
2. 一人で抱え込まないよう促す
3. 学校のカウンセラーや保健室、信頼できる先生への相談を推奨する
4. 具体的なサポート先の情報を提供する
`,
  3: `
【注意深い対話モード】
相談者は中程度のストレスを抱えています:
1. 共感的に傾聴する
2. 相談者の状況を整理し、理解を示す
3. 必要に応じて、友人や先生への相談も選択肢として提示する
4. セルフケアの方法を提案する
`,
  2: `
【通常対話モード】
相談者の悩みに対して:
1. 親身に傾聴する
2. 相談者の気持ちを理解し、共感を示す
3. 建設的な視点を提供する
`,
  1: `
【軽度相談モード】
日常的な相談に対して:
1. フレンドリーに対話する
2. 相談者の話を丁寧に聞く
3. 適切なアドバイスを提供する
`,
});

/** @type {Readonly<Record<NeedsType, string>>} */
const NEEDS_PROMPTS = Object.freeze({
  listening: `
【ニーズ: 傾聴重視】
- 相談者は話を聞いてもらいたいと感じています
- アドバイスは最小限にし、共感と理解を示すことに重点を置いてください
- 受容的な応答を心がけてください
`,
  solution: `
【ニーズ: 解決策提示】
- 相談者は具体的な解決策やアドバイスを求めています
- 実践的で具体的な提案を行ってください
- 押し付けにならないよう、複数の選択肢を提示してください
`,
  thinking: `
【ニーズ: 共に考える】
- 相談者は一緒に考えてほしいと感じています
- 質問を通じて相談者自身の考えを引き出してください
- 意思決定のサポートをしつつ、最終判断は相談者に委ねてください
`,
});

const VARIATION_HINT = `
※応答の多様性を意識してください:
- 前の応答と似た書き出しや言い回しを避ける
- 相談内容のキーワードを拾って、その人の言葉で返す
- ときには問いかけで返す、ときには短く受け止めるだけにするなど、緩急をつける
`;

/**
 * リスクレベル・ニーズ・モードに応じたシステムプロンプトを生成する純粋関数
 * @param {number} riskLevel
 * @param {string} needsType
 * @param {string} chatMode
 * @returns {string}
 */
export const generateSystemPrompt = (riskLevel, needsType, chatMode) => {
  const modePrompt =
    chatMode === 'solution' ? MODE_PROMPTS.solution : MODE_PROMPTS.listening;
  const riskPrompt =
    riskLevel === 5 ||
    riskLevel === 4 ||
    riskLevel === 3 ||
    riskLevel === 2 ||
    riskLevel === 1
      ? RISK_PROMPTS[riskLevel]
      : RISK_PROMPTS[1];
  const needsPrompt =
    needsType === 'solution' || needsType === 'thinking'
      ? NEEDS_PROMPTS[needsType]
      : NEEDS_PROMPTS.listening;

  return BASE_GUARDRAILS + modePrompt + riskPrompt + needsPrompt;
};

/**
 * 会話履歴をテキスト形式へ変換する純粋関数
 * @param {readonly ChatMessage[]} messages
 * @returns {string}
 */
export const formatConversationHistory = (messages) =>
  messages
    .map((msg) =>
      msg.role === 'user'
        ? `相談者: ${msg.content}\n`
        : `サポーター: ${msg.content}\n`
    )
    .join('');

/**
 * チャット応答生成用のプロンプト全体を組み立てる純粋関数
 * @param {string} userMessage
 * @param {number} riskLevel
 * @param {string} needsType
 * @param {readonly ChatMessage[]} chatHistory
 * @param {string} chatMode
 * @returns {string}
 */
export const buildFullChatPrompt = (
  userMessage,
  riskLevel,
  needsType,
  chatHistory,
  chatMode
) => {
  const systemPrompt = generateSystemPrompt(riskLevel, needsType, chatMode);
  const historyText = formatConversationHistory(chatHistory.slice(-4));
  return (
    systemPrompt +
    VARIATION_HINT +
    `\n\n【会話履歴】\n${historyText}\n\n` +
    `【現在の相談】\n相談者: ${userMessage}\n\nサポーター:`
  );
};

/**
 * 会話まとめ生成用のプロンプトを組み立てる純粋関数
 * @param {readonly ChatMessage[]} chatHistory
 * @returns {string}
 */
export const buildSummaryPrompt = (chatHistory) => {
  const conversationText = formatConversationHistory(chatHistory);
  return `
以下は学生相談システムでの会話履歴です。この会話を振り返り、以下の観点でまとめてください:

【会話履歴】
${conversationText}

【まとめる内容】
1. 相談の主なテーマ（2-3行）
2. 相談者の気持ちや状況（2-3行）
3. 話し合った内容のポイント（3-5項目、箇条書き）
4. 今後に向けてのヒント（2-3行）

温かく、前向きなトーンでまとめてください。専門用語は避け、相談者が自分の状況を客観的に振り返れるようにしてください。
`;
};

/** @type {readonly (readonly [string, string])[]} */
const ERROR_STATUS_MARKERS = Object.freeze([
  Object.freeze(['RESOURCE_EXHAUSTED', '429']),
  Object.freeze(['quota', '429']),
  Object.freeze(['PERMISSION_DENIED', '403']),
  Object.freeze(['API_KEY_INVALID', '400']),
  Object.freeze(['NOT_FOUND', '404']),
  Object.freeze(['UNAVAILABLE', '503']),
]);

/**
 * 例外オブジェクトからHTTPステータスコード文字列のみを安全に抽出する純粋関数
 * @param {unknown} error
 * @returns {string}
 */
export const errorStatus = (error) => {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = /** @type {{ code?: unknown }} */ (error).code;
    if (typeof code === 'number' && Number.isInteger(code) && code >= 400 && code <= 599) {
      return String(code);
    }
  }
  const text = String(error);
  const match = /\b([45]\d{2})\b/.exec(text);
  if (match !== null) {
    return match[1];
  }
  const lowerText = text.toLowerCase();
  for (const [marker, status] of ERROR_STATUS_MARKERS) {
    if (lowerText.includes(marker.toLowerCase())) {
      return status;
    }
  }
  return '不明';
};

/**
 * APIエラー一覧から認証情報や相談本文を含まない安全な案内メッセージを生成する純粋関数
 * @param {readonly ModelErrorEntry[]} errors
 * @returns {string}
 */
export const formatApiErrors = (errors) => {
  const statuses = errors.map(({ model, error }) => ({
    model,
    status: errorStatus(error),
  }));
  const codes = new Set(statuses.map((item) => item.status));
  /** @type {string[]} */
  const guidance = [];

  if (codes.has('400') || codes.has('401') || codes.has('403')) {
    guidance.push('APIキー・権限・リクエスト設定を確認してください。');
  }
  if (codes.has('429')) {
    guidance.push(
      'APIの利用上限に達したモデルがあります。Google AI Studioで割り当てと利用状況を確認してください。'
    );
  }
  if (codes.has('404')) {
    guidance.push(
      '利用できないモデルがあります。モデル名と、このプロジェクトでの利用可否を確認してください。'
    );
  }
  if (codes.has('500') || codes.has('502') || codes.has('503') || codes.has('504')) {
    guidance.push(
      'API側の一時的な障害やタイムアウトの可能性があります。時間をおいて再試行してください。'
    );
  }
  if (guidance.length === 0) {
    guidance.push('API呼び出しに失敗しました。接続状況やAPIの設定を確認してください。');
  }

  const details = statuses
    .map(({ model, status }) => `- ${model}: ${status}`)
    .join('\n');

  return (
    '応答を生成できませんでした。\n\n' +
    guidance.join('\n') +
    '\n\nモデル別エラー（HTTPステータス）:\n' +
    details
  );
};

/**
 * HTTPステータスコードを持つエラーを生成する
 * @param {number} statusCode
 * @param {string} message
 * @returns {Error & { code: number }}
 */
const createHttpError = (statusCode, message) => {
  const err = /** @type {Error & { code: number }} */ (new Error(message));
  err.code = statusCode;
  return err;
};

/**
 * Gemini API レスポンスJSONから生成テキストを安全に抽出する純粋関数
 * @param {unknown} payload
 * @returns {string | null}
 */
export const extractTextFromGeminiPayload = (payload) => {
  if (typeof payload !== 'object' || payload === null || !('candidates' in payload)) {
    return null;
  }
  const candidates = /** @type {{ candidates?: unknown }} */ (payload).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }
  const firstCandidate = /** @type {unknown} */ (candidates[0]);
  if (
    typeof firstCandidate !== 'object' ||
    firstCandidate === null ||
    !('content' in firstCandidate)
  ) {
    return null;
  }
  const content = /** @type {{ content?: unknown }} */ (firstCandidate).content;
  if (typeof content !== 'object' || content === null || !('parts' in content)) {
    return null;
  }
  const parts = /** @type {{ parts?: unknown }} */ (content).parts;
  if (!Array.isArray(parts) || parts.length === 0) {
    return null;
  }
  const texts = parts
    .map((part) => {
      if (typeof part === 'object' && part !== null && 'text' in part) {
        const text = /** @type {{ text?: unknown }} */ (part).text;
        return typeof text === 'string' ? text : '';
      }
      return '';
    })
    .filter((text) => text.length > 0);

  return texts.length > 0 ? texts.join('') : null;
};

const SAFETY_SETTINGS = Object.freeze([
  Object.freeze({ category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' }),
  Object.freeze({ category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' }),
  Object.freeze({ category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' }),
  Object.freeze({ category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }),
]);

/**
 * 単一モデルに対して Gemini generateContent REST API を呼び出す
 * @param {Object} params
 * @param {string} params.modelName
 * @param {string} params.apiKey
 * @param {string} params.prompt
 * @param {Record<string, unknown>} params.generationConfig
 * @param {boolean} params.includeSafetySettings
 * @param {typeof fetch} params.fetchImpl
 * @returns {Promise<string>}
 */
const requestGeminiModel = async ({
  modelName,
  apiKey,
  prompt,
  generationConfig,
  includeSafetySettings,
  fetchImpl,
}) => {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    modelName
  )}:generateContent`;

  /** @type {Record<string, unknown>} */
  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig,
  };
  if (includeSafetySettings) {
    requestBody.safetySettings = SAFETY_SETTINGS;
  }

  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    throw createHttpError(response.status, `HTTP ${response.status}`);
  }

  /** @type {unknown} */
  const payload = await response.json();
  const text = extractTextFromGeminiPayload(payload);
  if (text === null) {
    throw new Error('Empty response from Gemini API');
  }
  return text;
};

/**
 * Gemini API を使用してAI応答を生成する（フォールバック付き）
 * @param {Object} params
 * @param {string} params.userMessage
 * @param {number} params.riskLevel
 * @param {string} params.needsType
 * @param {readonly ChatMessage[]} params.chatHistory
 * @param {string} params.apiKey
 * @param {string} params.chatMode
 * @param {typeof fetch} [params.fetchImpl]
 * @returns {Promise<string>}
 */
export const generateAiResponseGemini = async ({
  userMessage,
  riskLevel,
  needsType,
  chatHistory,
  apiKey,
  chatMode,
  fetchImpl = globalThis.fetch,
}) => {
  try {
    const trimmedKey = apiKey.trim();
    if (trimmedKey.length === 0) {
      throw createHttpError(400, 'API_KEY_INVALID');
    }

    const fullPrompt = buildFullChatPrompt(
      userMessage,
      riskLevel,
      needsType,
      chatHistory,
      chatMode
    );

    /** @type {ModelErrorEntry[]} */
    const errors = [];

    for (const modelName of CHAT_MODELS) {
      try {
        return await requestGeminiModel({
          modelName,
          apiKey: trimmedKey,
          prompt: fullPrompt,
          generationConfig: {
            temperature: 0.85,
            topP: 0.92,
            maxOutputTokens: 500,
          },
          includeSafetySettings: true,
          fetchImpl,
        });
      } catch (error) {
        errors.push({ model: modelName, error });
      }
    }

    return formatApiErrors(errors);
  } catch (error) {
    return formatApiErrors([{ model: '初期化', error }]);
  }
};

/**
 * 会話全体のまとめを Gemini API で生成する
 * @param {Object} params
 * @param {readonly ChatMessage[]} params.chatHistory
 * @param {string} params.apiKey
 * @param {typeof fetch} [params.fetchImpl]
 * @returns {Promise<string>}
 */
export const generateConversationSummary = async ({
  chatHistory,
  apiKey,
  fetchImpl = globalThis.fetch,
}) => {
  try {
    const trimmedKey = apiKey.trim();
    if (trimmedKey.length === 0) {
      throw createHttpError(400, 'API_KEY_INVALID');
    }

    const summaryPrompt = buildSummaryPrompt(chatHistory);
    return await requestGeminiModel({
      modelName: SUMMARY_MODEL,
      apiKey: trimmedKey,
      prompt: summaryPrompt,
      generationConfig: {
        temperature: 0.5,
        maxOutputTokens: 800,
      },
      includeSafetySettings: false,
      fetchImpl,
    });
  } catch (error) {
    return formatApiErrors([{ model: `${SUMMARY_MODEL}（まとめ）`, error }]);
  }
};

/**
 * タイムスタンプ文字列（YYYYMMDD_HHMMSS）を生成する純粋関数
 * @param {Date} date
 * @returns {string}
 */
export const formatSummaryFileTimestamp = (date) => {
  const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  return `${year}${month}${day}_${hours}${minutes}${seconds}`;
};
