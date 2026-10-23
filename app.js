// @ts-check
import {
  analyzeNeeds,
  analyzeRiskLevel,
  formatSummaryFileTimestamp,
  generateAiResponseGemini,
  generateConversationSummary,
} from './core.js';

/**
 * @typedef {import('./core.js').ChatMessage} ChatMessage
 * @typedef {import('./core.js').ChatMode} ChatMode
 * @typedef {import('./core.js').NeedsType} NeedsType
 *
 * @typedef {Object} FeedbackEntry
 * @property {number} messageId
 * @property {number} rating
 * @property {string} timestamp
 *
 * @typedef {Object} AppState
 * @property {readonly ChatMessage[]} chatHistory
 * @property {readonly FeedbackEntry[]} feedbackData
 * @property {readonly number[]} submittedFeedbackIds
 * @property {number} currentRiskLevel
 * @property {string} apiKey
 * @property {boolean} apiKeySet
 * @property {boolean} showApiKeyError
 * @property {boolean} showInfo
 * @property {string | null} summary
 * @property {boolean} showSummary
 * @property {ChatMode} chatMode
 * @property {boolean} isLoading
 * @property {string} loadingText
 */

/** @type {Readonly<Record<NeedsType, string>>} */
const NEEDS_LABELS = Object.freeze({
  listening: '傾聴重視',
  solution: '解決策提示',
  thinking: '共に考える',
});

/** @type {Readonly<Record<ChatMode, string>>} */
const MODE_LABELS = Object.freeze({
  listening: '傾聴モード',
  solution: '解決策提案モード',
});

/**
 * 初期状態を生成する純粋関数
 * @returns {AppState}
 */
const createInitialState = () =>
  Object.freeze({
    chatHistory: Object.freeze([]),
    feedbackData: Object.freeze([]),
    submittedFeedbackIds: Object.freeze([]),
    currentRiskLevel: 0,
    apiKey: '',
    apiKeySet: false,
    showApiKeyError: false,
    showInfo: false,
    summary: null,
    showSummary: false,
    chatMode: 'listening',
    isLoading: false,
    loadingText: '考えています...',
  });

/**
 * 状態をイミュータブルに更新する純粋関数
 * @param {AppState} currentState
 * @param {Partial<AppState>} patch
 * @returns {AppState}
 */
const updateState = (currentState, patch) =>
  Object.freeze({
    ...currentState,
    ...patch,
  });

/**
 * 必須DOM要素を型安全に取得する
 * @template {HTMLElement} T
 * @param {string} id
 * @param {new () => T} ctor
 * @returns {T}
 */
const getRequiredElement = (id, ctor) => {
  const element = document.getElementById(id);
  if (!(element instanceof ctor)) {
    throw new Error(`必須DOM要素が見つからないか型が一致しません: #${id}`);
  }
  return element;
};

/**
 * 最新のassistantメッセージを取得する純粋関数
 * @param {readonly ChatMessage[]} chatHistory
 * @returns {ChatMessage | null}
 */
const getLastAssistantMessage = (chatHistory) => {
  if (chatHistory.length === 0) {
    return null;
  }
  const lastMsg = chatHistory[chatHistory.length - 1];
  return lastMsg.role === 'assistant' ? lastMsg : null;
};

/**
 * まとめテキストをファイルとしてダウンロードさせる
 * @param {string} summaryText
 * @param {Date} now
 */
const downloadSummaryFile = (summaryText, now) => {
  const timestamp = formatSummaryFileTimestamp(now);
  const fileName = `counseling_summary_${timestamp}.txt`;
  const blob = new Blob([summaryText], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
};

/**
 * アプリケーションを初期化する
 */
const initApp = () => {
  const apiKeySection = getRequiredElement('api-key-section', HTMLElement);
  const chatSection = getRequiredElement('chat-section', HTMLElement);
  const apiKeyForm = getRequiredElement('api-key-form', HTMLFormElement);
  const apiKeyInput = getRequiredElement('api-key-input', HTMLInputElement);
  const toggleApiKeyBtn = getRequiredElement(
    'toggle-api-key-visibility',
    HTMLButtonElement
  );
  const apiKeyError = getRequiredElement('api-key-error', HTMLElement);

  const summaryBtn = getRequiredElement('summary-btn', HTMLButtonElement);
  const infoBtn = getRequiredElement('info-btn', HTMLButtonElement);
  const resetBtn = getRequiredElement('reset-btn', HTMLButtonElement);

  const modeListeningBtn = getRequiredElement(
    'mode-listening-btn',
    HTMLButtonElement
  );
  const modeSolutionBtn = getRequiredElement(
    'mode-solution-btn',
    HTMLButtonElement
  );
  const modeCaption = getRequiredElement('mode-caption', HTMLElement);

  const infoPanel = getRequiredElement('info-panel', HTMLDetailsElement);
  const infoDynamicMetrics = getRequiredElement(
    'info-dynamic-metrics',
    HTMLElement
  );
  const detectedNeedsBox = getRequiredElement('detected-needs-box', HTMLElement);
  const currentModeBox = getRequiredElement('current-mode-box', HTMLElement);
  const changeApiKeyBtn = getRequiredElement(
    'change-api-key-btn',
    HTMLButtonElement
  );

  const summaryPanel = getRequiredElement('summary-panel', HTMLDetailsElement);
  const summaryContent = getRequiredElement('summary-content', HTMLElement);
  const closeSummaryBtn = getRequiredElement(
    'close-summary-btn',
    HTMLButtonElement
  );
  const downloadSummaryBtn = getRequiredElement(
    'download-summary-btn',
    HTMLButtonElement
  );

  const chatContainer = getRequiredElement('chat-container', HTMLElement);
  const loadingIndicator = getRequiredElement('loading-indicator', HTMLElement);
  const loadingText = getRequiredElement('loading-text', HTMLElement);
  const chatForm = getRequiredElement('chat-form', HTMLFormElement);
  const chatInput = getRequiredElement('chat-input', HTMLInputElement);
  const sendBtn = getRequiredElement('send-btn', HTMLButtonElement);

  let state = createInitialState();

  /**
   * フィードバック評価送信ハンドラ
   * @param {number} messageIndex
   * @param {number} ratingValue
   */
  const handleFeedbackSubmit = (messageIndex, ratingValue) => {
    const newFeedback = Object.freeze({
      messageId: messageIndex,
      rating: ratingValue,
      timestamp: new Date().toISOString(),
    });
    state = updateState(state, {
      feedbackData: Object.freeze([...state.feedbackData, newFeedback]),
      submittedFeedbackIds: Object.freeze([
        ...state.submittedFeedbackIds,
        messageIndex,
      ]),
    });
    render();
  };

  /**
   * チャット履歴のDOM要素を構築する
   * @param {AppState} currentState
   */
  const renderChatMessages = (currentState) => {
    chatContainer.innerHTML = '';

    if (currentState.chatHistory.length === 0) {
      const greetingBox = document.createElement('div');
      greetingBox.className = 'alert alert-info';
      greetingBox.textContent =
        '👋 こんにちは。何でも話しかけてみてください。ゆっくり、あなたのペースで大丈夫です。';
      chatContainer.appendChild(greetingBox);
      return;
    }

    currentState.chatHistory.forEach((message, index) => {
      const isUser = message.role === 'user';
      const wrapper = document.createElement('div');
      wrapper.className = `chat-message ${
        isUser ? 'chat-message-user' : 'chat-message-assistant'
      }`;

      const avatar = document.createElement('div');
      avatar.className = 'chat-avatar';
      avatar.setAttribute('aria-hidden', 'true');
      avatar.textContent = isUser ? '🙂' : '💭';

      const body = document.createElement('div');
      body.className = 'chat-body';

      const paragraph = document.createElement('p');
      paragraph.className = 'chat-text';
      paragraph.textContent = message.content;
      body.appendChild(paragraph);

      const isLatestAssistant =
        !isUser && index === currentState.chatHistory.length - 1;
      if (isLatestAssistant) {
        const expander = document.createElement('details');
        expander.className = 'feedback-expander';

        const summary = document.createElement('summary');
        summary.textContent = 'この応答は役に立ちましたか？';
        expander.appendChild(summary);

        const controls = document.createElement('div');
        controls.className = 'feedback-controls';

        const sliderGroup = document.createElement('div');
        sliderGroup.className = 'slider-group';

        const labelRow = document.createElement('div');
        labelRow.className = 'slider-label-row';
        const labelTitle = document.createElement('span');
        labelTitle.textContent = '評価';
        const labelValue = document.createElement('strong');
        labelValue.textContent = '3';
        labelRow.appendChild(labelTitle);
        labelRow.appendChild(labelValue);

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = '1';
        slider.max = '5';
        slider.step = '1';
        slider.value = '3';
        slider.className = 'rating-slider';
        slider.addEventListener('input', () => {
          labelValue.textContent = slider.value;
        });

        sliderGroup.appendChild(labelRow);
        sliderGroup.appendChild(slider);

        const actionCol = document.createElement('div');
        if (currentState.submittedFeedbackIds.includes(index)) {
          const thanksAlert = document.createElement('div');
          thanksAlert.className = 'alert alert-success';
          thanksAlert.textContent = 'ありがとうございます！';
          expander.open = true;
          actionCol.appendChild(thanksAlert);
        } else {
          const submitBtn = document.createElement('button');
          submitBtn.type = 'button';
          submitBtn.className = 'btn btn-secondary';
          submitBtn.textContent = '👍 送信';
          submitBtn.addEventListener('click', () => {
            handleFeedbackSubmit(index, Number(slider.value));
          });
          actionCol.appendChild(submitBtn);
        }

        controls.appendChild(sliderGroup);
        controls.appendChild(actionCol);
        expander.appendChild(controls);
        body.appendChild(expander);
      }

      wrapper.appendChild(avatar);
      wrapper.appendChild(body);
      chatContainer.appendChild(wrapper);
    });
  };

  /**
   * 現在の状態に基づいてUI全体を描画する
   */
  const render = () => {
    apiKeySection.classList.toggle('hidden', state.apiKeySet);
    chatSection.classList.toggle('hidden', !state.apiKeySet);
    apiKeyError.classList.toggle('hidden', !state.showApiKeyError);

    if (!state.apiKeySet) {
      return;
    }

    summaryBtn.disabled = state.chatHistory.length < 2 || state.isLoading;
    resetBtn.disabled = state.isLoading;
    chatInput.disabled = state.isLoading;
    sendBtn.disabled = state.isLoading;

    const listeningSelected = state.chatMode === 'listening';
    modeListeningBtn.className = `btn ${
      listeningSelected ? 'btn-primary' : 'btn-secondary'
    }`;
    modeListeningBtn.textContent = `🫂 傾聴モード${
      listeningSelected ? ' ✅' : ''
    }`;

    const solutionSelected = state.chatMode === 'solution';
    modeSolutionBtn.className = `btn ${
      solutionSelected ? 'btn-primary' : 'btn-secondary'
    }`;
    modeSolutionBtn.textContent = `💡 解決策提案モード${
      solutionSelected ? ' ✅' : ''
    }`;

    modeCaption.innerHTML = '';
    if (listeningSelected) {
      const strong = document.createElement('strong');
      strong.textContent = '傾聴モード';
      modeCaption.append('🫂 ', strong, ': 気持ちに寄り添い、じっくり話を聞きます。アドバイスより共感を大切にします。');
    } else {
      const strong = document.createElement('strong');
      strong.textContent = '解決策提案モード';
      modeCaption.append('💡 ', strong, ': 具体的な行動や選択肢を一緒に考えます。前向きに進むためのヒントをお伝えします。');
    }

    infoPanel.classList.toggle('hidden', !state.showInfo);
    if (state.showInfo) {
      const lastAssistant = getLastAssistantMessage(state.chatHistory);
      if (lastAssistant !== null) {
        infoDynamicMetrics.classList.remove('hidden');
        const needsKey = lastAssistant.needsType ?? 'listening';
        detectedNeedsBox.textContent = `検出ニーズ: ${NEEDS_LABELS[needsKey]}`;
        currentModeBox.textContent = `現在のモード: ${
          MODE_LABELS[state.chatMode]
        }`;
      } else {
        infoDynamicMetrics.classList.add('hidden');
      }
    }

    const shouldShowSummary =
      state.showSummary && typeof state.summary === 'string' && state.summary.length > 0;
    summaryPanel.classList.toggle('hidden', !shouldShowSummary);
    if (shouldShowSummary && state.summary !== null) {
      summaryContent.textContent = state.summary;
    }

    loadingIndicator.classList.toggle('hidden', !state.isLoading);
    loadingText.textContent = state.loadingText;

    renderChatMessages(state);
  };

  // イベント登録
  toggleApiKeyBtn.addEventListener('click', () => {
    apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
  });

  apiKeyForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const trimmed = apiKeyInput.value.trim();
    if (trimmed.length === 0) {
      state = updateState(state, { showApiKeyError: true });
      render();
      return;
    }
    state = updateState(state, {
      apiKey: trimmed,
      apiKeySet: true,
      showApiKeyError: false,
    });
    render();
    chatInput.focus();
  });

  modeListeningBtn.addEventListener('click', () => {
    if (state.chatMode !== 'listening') {
      state = updateState(state, { chatMode: 'listening' });
      render();
    }
  });

  modeSolutionBtn.addEventListener('click', () => {
    if (state.chatMode !== 'solution') {
      state = updateState(state, { chatMode: 'solution' });
      render();
    }
  });

  infoBtn.addEventListener('click', () => {
    state = updateState(state, { showInfo: !state.showInfo });
    render();
  });

  changeApiKeyBtn.addEventListener('click', () => {
    state = updateState(state, { apiKeySet: false });
    render();
  });

  resetBtn.addEventListener('click', () => {
    state = updateState(state, {
      chatHistory: Object.freeze([]),
      submittedFeedbackIds: Object.freeze([]),
      currentRiskLevel: 0,
      summary: null,
      showSummary: false,
    });
    render();
  });

  summaryBtn.addEventListener('click', async () => {
    if (state.chatHistory.length < 2 || state.isLoading) {
      return;
    }
    state = updateState(state, {
      isLoading: true,
      loadingText: '会話をまとめています...',
    });
    render();

    const summaryText = await generateConversationSummary({
      chatHistory: state.chatHistory,
      apiKey: state.apiKey,
    });

    state = updateState(state, {
      isLoading: false,
      summary: summaryText,
      showSummary: true,
    });
    render();
  });

  closeSummaryBtn.addEventListener('click', () => {
    state = updateState(state, { showSummary: false });
    render();
  });

  downloadSummaryBtn.addEventListener('click', () => {
    if (typeof state.summary === 'string' && state.summary.length > 0) {
      downloadSummaryFile(state.summary, new Date());
    }
  });

  chatForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const userText = chatInput.value.trim();
    if (userText.length === 0 || state.isLoading) {
      return;
    }

    chatInput.value = '';

    /** @type {ChatMessage} */
    const userMessage = Object.freeze({
      role: 'user',
      content: userText,
      timestamp: new Date().toISOString(),
    });

    const updatedHistory = Object.freeze([...state.chatHistory, userMessage]);
    const { riskLevel, detectedKeywords } = analyzeRiskLevel(userText);
    const needsType = analyzeNeeds(userText);
    const nextMaxRiskLevel = Math.max(state.currentRiskLevel, riskLevel);

    state = updateState(state, {
      chatHistory: updatedHistory,
      currentRiskLevel: nextMaxRiskLevel,
      isLoading: true,
      loadingText: '考えています...',
    });
    render();

    const aiResponseText = await generateAiResponseGemini({
      userMessage: userText,
      riskLevel,
      needsType,
      chatHistory: updatedHistory,
      apiKey: state.apiKey,
      chatMode: state.chatMode,
    });

    /** @type {ChatMessage} */
    const assistantMessage = Object.freeze({
      role: 'assistant',
      content: aiResponseText,
      timestamp: new Date().toISOString(),
      riskLevel,
      needsType,
      detectedKeywords,
    });

    state = updateState(state, {
      chatHistory: Object.freeze([...state.chatHistory, assistantMessage]),
      isLoading: false,
    });
    render();
    chatInput.focus();
  });

  render();
};

document.addEventListener('DOMContentLoaded', initApp);
