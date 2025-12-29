import bindAll from 'lodash.bindall';
import debounce from 'lodash.debounce';
import defaultsDeep from 'lodash.defaultsdeep';
import makeToolboxXML from '../lib/make-toolbox-xml';
import PropTypes from 'prop-types';
import React from 'react';
import VMScratchBlocks from '../lib/blocks';
import VM from 'scratch-vm-for-gemini-chatbot';
import log from '../lib/log.js';
import Prompt from './prompt.jsx';
import BlocksComponent from '../components/blocks/blocks.jsx';
import ExtensionLibrary from './extension-library.jsx';
import extensionData from '../lib/libraries/extensions/index.jsx';
import CustomProcedures from './custom-procedures.jsx';
import errorBoundaryHOC from '../lib/error-boundary-hoc.jsx';
import {BLOCKS_DEFAULT_SCALE, STAGE_DISPLAY_SIZES} from '../lib/layout-constants';
import DropAreaHOC from '../lib/drop-area-hoc.jsx';
import DragConstants from '../lib/drag-constants';
import defineDynamicBlock from '../lib/define-dynamic-block';
import {DEFAULT_THEME, getColorsForTheme, themeMap} from '../lib/themes';
import {injectExtensionBlockTheme, injectExtensionCategoryTheme} from '../lib/themes/blockHelpers';
import {connect} from 'react-redux';
import {updateToolbox} from '../reducers/toolbox';
import {activateColorPicker} from '../reducers/color-picker';
import {closeExtensionLibrary, openSoundRecorder, openConnectionModal} from '../reducers/modals';
import {activateCustomProcedures, deactivateCustomProcedures} from '../reducers/custom-procedures';
import {setConnectionModalExtensionId} from '../reducers/connection-modal';
import {updateMetrics} from '../reducers/workspace-metrics';
import {isTimeTravel2020} from '../reducers/time-travel';
import {
    activateTab,
    SOUNDS_TAB_INDEX
} from '../reducers/editor-tab';
import { GoogleGenerativeAI } from '@google/generative-ai'; // not used directly; calls proxied through backend
import html2canvas from 'html2canvas'; // not used directly; custom screenshot fn used

const addFunctionListener = (object, property, callback) => {
    const oldFn = object[property];
    object[property] = function (...args) {
        const result = oldFn.apply(this, args);
        callback.apply(this, result);
        return result;
    };
};

const DroppableBlocks = DropAreaHOC([
    DragConstants.BACKPACK_CODE
])(BlocksComponent);

// Env (not directly used here; server proxies Gemini)
const GEMINI_API_KEY = process.env.REACT_APP_GEMINI_API_KEY;

class Blocks extends React.Component {
    constructor (props) {
        super(props);
        this.ScratchBlocks = VMScratchBlocks(props.vm, false);
        bindAll(this, [
            'attachVM',
            'detachVM',
            'getToolboxXML',
            'handleCategorySelected',
            'handleConnectionModalStart',
            'handleDrop',
            'handleStatusButtonUpdate',
            'handleOpenSoundRecorder',
            'handlePromptStart',
            'handlePromptCallback',
            'handlePromptClose',
            'handleCustomProceduresClose',
            'onScriptGlowOn',
            'onScriptGlowOff',
            'onBlockGlowOn',
            'onBlockGlowOff',
            'handleMonitorsUpdate',
            'handleExtensionAdded',
            'handleBlocksInfoUpdate',
            'onTargetsUpdate',
            'onVisualReport',
            'onWorkspaceUpdate',
            'onWorkspaceMetricsChange',
            'setBlocks',
            'setLocale',
            'toggleGeminiChat',
            'initializeGemini',
            'handleGeminiInputChange',
            'handleGeminiInputSubmit',
            'handleIncludeScreenshotChange',
            'handleCanGeminiReadCodeChange',
            'pipeResponseToExternalInput',
            'simulateClickZAndFocusInput',
            'waitForElement',
            'tryWaitForElement',
            'typeText',
            'pressEnter',
            'dispatchKeySeries',
            'ensureKeyboardFocus',
            'isEditable',
            'makeFocusable',
            'dispatchKeyEverywhere',
            // helpers added for robust paste
            'sleep',
            '_isVisible',
            '_placeCaretAtEnd',
            '_getValue',
            '_setReactValue',
            '_deepQueryAll',
            '_findInSameOriginIframes',
            '_findExternalInputFresh'
        ]);
        this.ScratchBlocks.prompt = this.handlePromptStart;
        this.ScratchBlocks.statusButtonCallback = this.handleConnectionModalStart;
        this.ScratchBlocks.recordSoundCallback = this.handleOpenSoundRecorder;
        this.state = {
            prompt: null,
            showGeminiChat: false,
            geminiInput: '',
            geminiOutput: [],
            includeScreenshot: false,
            submitting: false,
            canGeminiReadCode: false
        };
        this.onTargetsUpdate = debounce(this.onTargetsUpdate, 100);
        this.toolboxUpdateQueue = [];
        this.geminiModel = null;
        this.initializeGemini();
        this.inputRef = React.createRef();
        this.EXTERNAL_INPUT_SELECTOR = 'input.input_input-form_rYjUv';
    }

    componentDidUpdate(prevProps, prevState) {
        if (this.state.geminiInput !== prevState.geminiInput &&
            this.state.showGeminiChat &&
            this.inputRef.current) {
            const input = this.inputRef.current;
            const currentLength = input.value.length;
            input.setSelectionRange(currentLength, currentLength);
            input.focus();
        }
    }

    // ================== Robust input targeting + piping helpers ==================
    sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    _isVisible(el) {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const op = style.opacity === '' ? 1 : parseFloat(style.opacity);
        return rect.width > 0 && rect.height > 0 &&
               style.visibility !== 'hidden' &&
               style.display !== 'none' &&
               op > 0;
    }

    _placeCaretAtEnd(el) {
        try {
            if ('setSelectionRange' in el) {
                const len = el.value?.length ?? 0;
                el.setSelectionRange(len, len);
            } else {
                const range = document.createRange();
                range.selectNodeContents(el);
                range.collapse(false);
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(range);
            }
        } catch {}
    }

    _getValue(el) {
        if (!el) return '';
        if ('value' in el) return el.value;
        return el.textContent || '';
    }

    _setReactValue(el, value) {
        const proto = el instanceof HTMLTextAreaElement
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype;
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        if (desc && desc.set) desc.set.call(el, value);
        else el.value = value;
        try {
            el.dispatchEvent(new InputEvent('beforeinput', {
                inputType: 'insertText', data: value, bubbles: true, composed: true, cancelable: true
            }));
        } catch {}
        el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    }

    _deepQueryAll(root, selector, out = []) {
        try {
            const els = root.querySelectorAll(selector);
            els && els.forEach(e => out.push(e));
        } catch {}
        const walker = document.createNodeIterator(root, NodeFilter.SHOW_ELEMENT);
        for (let node; (node = walker.nextNode()); ) {
            const sr = node.shadowRoot;
            if (sr) this._deepQueryAll(sr, selector, out);
        }
        return out;
    }

    _findInSameOriginIframes(selector) {
        const frames = Array.from(document.querySelectorAll('iframe'));
        for (const f of frames) {
            try {
                const doc = f.contentDocument;
                if (!doc) continue;
                const matches = this._deepQueryAll(doc, selector);
                if (matches?.length) {
                    const best = matches.find(this._isVisible) || matches[0];
                    if (best) return best;
                }
            } catch {
                // cross-origin: ignore
            }
        }
        return null;
    }

    _findExternalInputFresh() {
        const selectors = [
            'input.input_input-form_rYjUv',
            'textarea.input_input-form_rYjUv',
            '[role="textbox"].input_input-form_rYjUv',
            'div.input_input-form_rYjUv[contenteditable="true"]',
            // generic fallbacks
            'input[type="text"]:not([disabled])',
            'textarea:not([disabled])',
            '[contenteditable="true"]',
            '[role="textbox"]'
        ];

        for (const sel of selectors) {
            const all = this._deepQueryAll(document, sel);
            const cand = (all.find(this._isVisible) || all[0]);
            if (cand) return cand;
        }
        for (const sel of selectors) {
            const cand = this._findInSameOriginIframes(sel);
            if (cand) return cand;
        }
        const ae = document.activeElement;
        if (this.isEditable(ae)) return ae;
        return null;
    }
    // ================== /helpers ==================

    // Focus plumbing
    async ensureKeyboardFocus() {
        const ae = document.activeElement;
        if (this.isEditable(ae)) { try { ae.blur(); } catch {} }
        await new Promise(r => requestAnimationFrame(r));
        const root = this.makeFocusable(document.body || document.documentElement);
        if (root) { try { root.focus({ preventScroll: true }); } catch {} }
        await new Promise(r => setTimeout(r, 10));
    }

    isEditable(el) {
        if (!el) return false;
        const tag = (el.tagName || '').toUpperCase();
        if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
        if (el.getAttribute && el.getAttribute('role') === 'textbox') return true;
        if ('isContentEditable' in el && el.isContentEditable) return true;
        return false;
    }

    makeFocusable(el) {
        if (!el || typeof el.focus !== 'function') return null;
        if (!el.hasAttribute('tabindex')) {
            try { el.setAttribute('tabindex', '-1'); } catch {}
        }
        return el;
    }

    dispatchKeyEverywhere(key, code = 'KeyA') {
        const inferKeyCode = () => {
            if (key === 'Enter') return 13;
            if (key === ' ') return 32;
            if (key && key.length === 1) return key.toUpperCase().charCodeAt(0);
            return 0;
        };
        const k = inferKeyCode();
        const fire = (target, type) => {
            if (!target || !target.dispatchEvent) return;
            try {
                const ev = new KeyboardEvent(type, {
                    key, code, keyCode: k, which: k, bubbles: true, composed: true, cancelable: true
                });
                target.dispatchEvent(ev);
            } catch {}
        };
        const targets = [window, document, document.body, document.activeElement].filter(Boolean);
        for (const t of targets) {
            fire(t, 'keydown'); fire(t, 'keypress'); fire(t, 'keyup');
        }
    }

    async waitForElement(selector, timeoutMs = 6000, mustBeVisible = true) {
        const deadline = performance.now() + timeoutMs;
        const isVisible = el => {
            if (!el) return false;
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            return rect.width > 0 && rect.height > 0 &&
                   style.visibility !== 'hidden' && style.display !== 'none';
        };

        const searchOnce = () => {
            let el = document.querySelector(selector);
            if (el && (!mustBeVisible || isVisible(el))) return el;

            const iframes = Array.from(document.querySelectorAll('iframe'));
            for (const frame of iframes) {
                try {
                    const doc = frame.contentDocument;
                    if (!doc) continue;
                    const cand = doc.querySelector(selector);
                    if (cand && (!mustBeVisible || isVisible(cand))) return cand;
                } catch {}
            }
            return null;
        };

        while (performance.now() < deadline) {
            const found = searchOnce();
            if (found) return found;
            await new Promise(r => setTimeout(r, 50));
        }
        throw new Error(`Element not found or not visible: ${selector}`);
    }

    async tryWaitForElement(selector, timeoutMs = 1500, mustBeVisible = true) {
        try { return await this.waitForElement(selector, timeoutMs, mustBeVisible); }
        catch { return null; }
    }

    dispatchKeySeries(target, key, code = 'KeyA', keyCode) {
        const infer = () => {
            if (typeof keyCode === 'number') return keyCode;
            if (key === 'Enter') return 13;
            if (key === ' ') return 32;
            if (key && key.length === 1) return key.toUpperCase().charCodeAt(0);
            return 0;
        };
        const k = infer();
        const base = { key, code, keyCode: k, which: k, bubbles: true, composed: true };
        target.dispatchEvent(new KeyboardEvent('keydown', base));
        target.dispatchEvent(new KeyboardEvent('keypress', base));
        target.dispatchEvent(new KeyboardEvent('keyup', base));
    }

    // === UPDATED: open overlay with 'z', then locate FRESH input every time ===
    async simulateClickZAndFocusInput() {
        await this.ensureKeyboardFocus();

        const candidates = [
            '[data-key="z"]','[data-key="Z"]','[aria-label="z"]','[aria-label="Z"]','.key-z','.KeyZ'
        ];
        let zEl = null;
        for (const sel of candidates) {
            const el = document.querySelector(sel);
            if (el) { zEl = el; break; }
        }
        if (zEl) zEl.click();
        else this.dispatchKeyEverywhere('z', 'KeyZ');

        // Let UI render (double rAF + small wait)
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        await this.sleep(30);

        let input = this._findExternalInputFresh();
        if (!input) throw new Error('Target textbox not found after pressing "z".');

        this.makeFocusable(input);
        try { input.focus({ preventScroll: true }); } catch {}
        this._placeCaretAtEnd(input);
        await this.sleep(10);
        return input;
    }

    // Use native setter so React sees change
    setNativeValue(el, value) {
        const proto = el instanceof HTMLTextAreaElement
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype;
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        if (desc && desc.set) desc.set.call(el, value);
        else el.value = value;
    }

    async typeText(inputEl, text, perCharDelayMs = 6) {
        inputEl.focus();
        if ('value' in inputEl) {
            this.setNativeValue(inputEl, '');
            inputEl.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        } else {
            inputEl.textContent = '';
            inputEl.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }));
        }

        for (const ch of text) {
            if ('value' in inputEl) {
                this.setNativeValue(inputEl, inputEl.value + ch);
                inputEl.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
            } else {
                inputEl.textContent = (inputEl.textContent || '') + ch;
                inputEl.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, data: ch }));
            }
            const code = /^[a-z]$/i.test(ch) ? `Key${ch.toUpperCase()}` : (ch === ' ' ? 'Space' : '');
            this.dispatchKeySeries(inputEl, ch, code);
            await new Promise(r => setTimeout(r, perCharDelayMs));
        }
    }

    async pressEnter(inputEl) {
        this.dispatchKeySeries(inputEl, 'Enter', 'Enter', 13);
        if (inputEl.form) {
            inputEl.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        }
        const scope = inputEl.form || document;
        const selectors = ['[type="submit"]','button[type="submit"]','button[aria-label="Send"]','[data-testid="send"]'];
        for (const sel of selectors) {
            const btn = scope.querySelector(sel);
            if (btn && !btn.disabled) { btn.click(); return; }
        }
        const buttons = Array.from(scope.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]'));
        const sendBtn = buttons.find(b => (b.innerText || b.value || '').trim().toLowerCase() === 'send');
        if (sendBtn && !sendBtn.disabled) sendBtn.click();
    }

    // === UPDATED: robust piping with re-find, shadow DOM, verification, backoff ===
    async pipeResponseToExternalInput(text) {
        try {
            await this.simulateClickZAndFocusInput();

            const waits = [20, 50, 100, 200, 400, 800];

            const tryOnce = async () => {
                let el = this._findExternalInputFresh();
                if (!el) return false;

                this.makeFocusable(el);
                try { el.click(); } catch {}
                try { el.focus({ preventScroll: true }); } catch {}
                this._placeCaretAtEnd(el);
                await this.sleep(10);

                const before = this._getValue(el);

                if (window.electronAPI?.insertText) {
                    await window.electronAPI.insertText(text);
                } else if (window.electronAPI?.writeClipboard) {
                    await window.electronAPI.writeClipboard(text);
                    if (window.electronAPI?.pasteFocused) {
                        await window.electronAPI.pasteFocused();
                    } else if (document.execCommand) {
                        document.execCommand('paste');
                    } else {
                        await this.typeText(el, text);
                    }
                } else {
                    await this.typeText(el, text);
                }

                await this.sleep(10);
                el = this._findExternalInputFresh() || el;
                const after = this._getValue(el);

                const ok = typeof after === 'string' && (
                    after.endsWith(text) || after.includes(text) ||
                    after.length >= Math.max(before.length, text.length)
                );

                if (!ok) {
                    this._setReactValue(el, text);
                    await this.sleep(5);
                    const reAfter = this._getValue(el);
                    return typeof reAfter === 'string' && (reAfter.endsWith(text) || reAfter.includes(text));
                }
                return true;
            };

            let success = false;
            for (const w of waits) {
                success = await tryOnce();
                if (success) break;
                await this.sleep(w);
            }
            if (!success) success = await tryOnce();

            if (success) {
                await this.sleep(30);
                if (window.electronAPI?.pressEnter) {
                    await window.electronAPI.pressEnter();
                } else {
                    const el = this._findExternalInputFresh() || document.activeElement || document.body;
                    await this.pressEnter(el);
                }
            } else {
                console.warn('⚠️ Could not verify text insertion after retries; skipping Enter to avoid empty submit.');
            }
        } catch (e) {
            console.warn('Auto-typing into external input failed:', e);
        }
    }
    // ================== END robust piping ==================

    // Gemini bootstrap (proxied to localhost:3001)
    initializeGemini() {
        this.geminiModel = {
            generateContent: async ({ contents }) => {
                const response = await fetch('http://localhost:3001/api/gemini', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        userInput: contents[0].parts.find(p => p.text)?.text,
                        screenshotBase64: contents[0].parts.find(p => p.inlineData)?.inlineData?.data
                    })
                });

                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    const message = errorData?.error || 'Failed to fetch from backend';
                    throw new Error(message);
                }

                const data = await response.json();
                if (!data.message) throw new Error("Gemini backend returned no message field");
                return {
                    response: { text: () => data.message }
                };
            }
        };
    }

    handleGeminiInputChange(e) {
        this.setState({ geminiInput: e.target.value });
    }

    handleIncludeScreenshotChange(e) {
        this.setState({ includeScreenshot: e.target.checked });
    }

    handleCanGeminiReadCodeChange(e) {
        this.setState({ canGeminiReadCode: e.target.checked });
    }

    async handleGeminiInputSubmit(e) {
        if (e.key === 'Enter' || e.type === 'click') {
            e.preventDefault();
        } else {
            return;
        }

        const userInput = this.inputRef.current?.value.trim();
        if (!userInput) return;

        if (this.state.submitting) {
            console.log("Submission already in progress, ignoring.");
            return;
        }

        this.setState({ submitting: true });

        const userMessageId = crypto.randomUUID();
        const thinkingMessageId = crypto.randomUUID();

        if (this.inputRef.current) this.inputRef.current.value = '';

        this.setState(prevState => ({
            geminiOutput: [
                ...prevState.geminiOutput,
                { id: userMessageId, type: 'user', message: userInput, hasScreenshot: false, timestamp: Date.now() },
                { id: thinkingMessageId, type: 'gemini-thinking', message: 'Gemini: Thinking...', timestamp: Date.now() }
            ]
        }));

        if (!this.geminiModel) {
            this.setState(prevState => ({
                geminiOutput: prevState.geminiOutput.map(msg =>
                    msg.id === thinkingMessageId
                        ? { ...msg, type: 'error', message: 'Gemini model is not initialized.' }
                        : msg
                ),
                submitting: false
            }));
            return;
        }

        let screenshotBase64 = null;
        if (this.state.includeScreenshot) {
            this.setState(prevState => ({
                geminiOutput: prevState.geminiOutput.map(msg =>
                    msg.id === userMessageId
                        ? { ...msg, hasScreenshot: true }
                        : msg
                )
            }));
            screenshotBase64 = await captureCanvasScreenshotWithRetry();
        }

        // (Optional) context to send with prompt
        const target = this.props.vm.editingTarget;
        let contextText = 'Project context:\n';
        if (target) {
            const spriteName = target.getName();
            const costume = target.getCostumes()?.[target.currentCostume];
            const blocks = target.blocks._blocks;
            const activeBlocks = Object.values(blocks)
                .filter(b => b.opcode && !b.shadow)
                .map(b => b.opcode)
                .join(', ');
            contextText += `- Sprite: ${spriteName}\n`;
            contextText += `- Costume: ${costume?.name || 'Unknown'}\n`;
            contextText += `- Position: (${target.x}, ${target.y})\n`;
            contextText += `- Is Stage: ${target.isStage}\n`;
            contextText += `- Active Block Types: ${activeBlocks}\n`;
        } else {
            contextText += '(No active target found)\n';
        }

        // Screenshot helpers inside handler scope (used when includeScreenshot is on)
        async function captureCanvasScreenshot() {
            try {
                const canvas = document.querySelector('.stage-wrapper canvas, .stage-and-target-wrapper canvas, .scratch-stage canvas, canvas');
                if (!canvas) {
                    console.warn("⚠️ WebGL canvas not found in known containers.");
                    return null;
                }
                const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
                if (gl) gl.flush();

                await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                await new Promise(resolve => setTimeout(resolve, 100));

                const offscreen = document.createElement('canvas');
                offscreen.width = canvas.width;
                offscreen.height = canvas.height;
                const ctx = offscreen.getContext('2d');
                ctx.drawImage(canvas, 0, 0);

                const data = ctx.getImageData(0, 0, offscreen.width, offscreen.height).data;
                const isBlack = data.every((val, idx) => val === 0 || (idx + 1) % 4 === 0);
                if (isBlack) console.warn("⚠️ Screenshot is completely black.");

                const base64 = offscreen.toDataURL('image/png').split(',')[1];
                return base64;
            } catch (err) {
                console.error("❌ Screenshot capture failed:", err);
                return null;
            }
        }
        async function captureCanvasScreenshotWithRetry(maxAttempts = 200, delay = 0.1) {
            for (let attempt = 0; attempt < maxAttempts; attempt++) {
                const base64 = await captureCanvasScreenshot();
                if (base64) {
                    const img = new Image();
                    img.src = 'data:image/png;base64,' + base64;
                    await new Promise(resolve => (img.onload = resolve));
                    const tempCanvas = document.createElement('canvas');
                    tempCanvas.width = img.width;
                    tempCanvas.height = img.height;
                    const ctx = tempCanvas.getContext('2d');
                    ctx.drawImage(img, 0, 0);
                    const data = ctx.getImageData(0, 0, tempCanvas.width, tempCanvas.height).data;
                    const isBlack = data.every((val, idx) => val === 0 || (idx + 1) % 4 === 0);
                    if (!isBlack) return base64;
                }
                await new Promise(resolve => setTimeout(resolve, delay));
            }
            console.warn("⚠️ All screenshot attempts resulted in black images.");
            return null;
        }

        // child-safe wrapper (kept as-is from your code)
        const filterInstruction = "You are a kind, caring, and helpful AI assistant. A child has entered the prompt I will be eventually giving you. Please ensure that your responses are all child safe and do not contain any terms that may harm the child in any way. If you are unsure about a response, please ask the child to clarify what they mean. Do not use any terms that may be considered inappropriate for children. If you are asked to do something that is not child safe, please refuse and explain why it is not appropriate while also not saying anything inappropriate for children. thank you very much for your help, here is their response. only respond to the prompt. USE THE SAME LOGIC IF GIVEN AN IMAGE, IF YOU DEEM AN IMAGE INAPPROPRIATE AND RECEIVE EVIDENCE THROUGH THE IMAGE THAT IT IS INAPPROPRIATE USE THE SAME LOGIC FROM RESPONSES ONTO THE IMAGE. Thank you once again for your help";

        const wrappedPrompt =
        `<text>${userInput}</text>\n` +
        `<send_to_gemini>${filterInstruction}</send_to_gemini>`;

        // Build system / tutoring instructions + optional project JSON context
        const tutorInstructions = `Please answer the student's prompt based on the provided source code if source code is provided.`;

        let contextTextForGemini = '';
        if (this.state.canGeminiReadCode) {
            try {
                const projectJsonObj = this.props.vm && typeof this.props.vm.toJSON === 'function' ? this.props.vm.toJSON() : null;
                if (projectJsonObj) {
                    const projectJson = JSON.stringify(projectJsonObj);
                    const MAX_CHARS = 20000;
                    let projectPayload = projectJson;
                    if (projectJson.length > MAX_CHARS) {
                        projectPayload = projectJson.slice(0, MAX_CHARS) + `\n...TRUNCATED (${projectJson.length - MAX_CHARS} chars)`;
                    }
                    contextTextForGemini = `CONTEXT: The following is the student's Scratch project in JSON form. Use it to answer the question specifically.\n\nCODE:\n${projectPayload}\n\n`;
                } else {
                    contextTextForGemini = 'CONTEXT: (Could not export project JSON)\n\n';
                }
            } catch (err) {
                console.warn('Could not stringify VM project JSON for Gemini:', err);
                contextTextForGemini = 'CONTEXT: (Error exporting project JSON)\n\n';
            }
        }

        const parts = [{ text: `${tutorInstructions}\n\n${filterInstruction}\n\n${contextTextForGemini}STUDENT QUESTION: ${userInput}` }];
        if (screenshotBase64) {
            parts.push({ inlineData: { mimeType: "image/png", data: screenshotBase64 } });
        }

        try {
            let response;
            try {
                const result = await this.geminiModel.generateContent({ contents: [{ role: "user", parts }] });
                response = result?.response;
                if (!response || typeof response.text !== 'function') {
                    throw new Error("Gemini API returned no valid response");
                }
            } catch (err) {
                throw new Error("Gemini failed to generate a response: " + err.message);
            }

            const text = response.text();
            this.setState(prevState => ({
                geminiOutput: prevState.geminiOutput.map(msg =>
                    msg.id === thinkingMessageId ? { ...msg, type: 'gemini', message: text } : msg
                ),
                submitting: false
            }));
        } catch (error) {
            console.error("Gemini error:", error);
            this.setState(prevState => ({
                geminiOutput: prevState.geminiOutput.map(msg =>
                    msg.id === thinkingMessageId
                        ? { ...msg, type: 'error', message: `Gemini: Error: ${error.message}` }
                        : msg
                ),
                submitting: false
            }));
        }
    }



    // Class-level screenshot retry (used by Analyze Next Move)
    captureCanvasScreenshotWithRetry = async (maxAttempts = 200, delay = 0.1) => {
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const base64 = await this.captureCanvasScreenshot();
            if (base64) {
                const img = new Image();
                img.src = 'data:image/png;base64,' + base64;
                await new Promise(resolve => (img.onload = resolve));
                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = img.width;
                tempCanvas.height = img.height;
                const ctx = tempCanvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                const data = ctx.getImageData(0, 0, tempCanvas.width, tempCanvas.height).data;
                const isBlack = data.every((val, idx) => val === 0 || (idx + 1) % 4 === 0);
                if (!isBlack) return base64;
            }
            await new Promise(resolve => setTimeout(resolve, delay));
        }
        console.warn("⚠️ All screenshot attempts resulted in black images.");
        return null;
    };

    captureCanvasScreenshot = async () => {
        try {
            const canvas = document.querySelector('.stage-wrapper canvas, .stage-and-target-wrapper canvas, .scratch-stage canvas, canvas');
            if (!canvas) {
                console.warn("⚠️ WebGL canvas not found in known containers.");
                return null;
            }
            const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
            if (gl) gl.flush();

            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            await new Promise(resolve => setTimeout(resolve, 100));

            const offscreen = document.createElement('canvas');
            offscreen.width = canvas.width;
            offscreen.height = canvas.height;
            const ctx = offscreen.getContext('2d');
            ctx.drawImage(canvas, 0, 0);

            const data = ctx.getImageData(0, 0, offscreen.width, offscreen.height).data;
            const isBlack = data.every((val, idx) => val === 0 || (idx + 1) % 4 === 0);
            if (isBlack) console.warn("⚠️ Screenshot is completely black.");

            const base64 = offscreen.toDataURL('image/png').split(',')[1];
            return base64;
        } catch (err) {
            console.error("❌ Screenshot capture failed:", err);
            return null;
        }
    };

    componentDidMount () {
        this.ScratchBlocks = VMScratchBlocks(this.props.vm, this.props.useCatBlocks);
        this.ScratchBlocks.prompt = this.handlePromptStart;
        this.ScratchBlocks.statusButtonCallback = this.handleConnectionModalStart;
        this.ScratchBlocks.recordSoundCallback = this.handleOpenSoundRecorder;
        this.ScratchBlocks.FieldColourSlider.activateEyedropper_ = this.props.onActivateColorPicker;
        this.ScratchBlocks.Procedures.externalProcedureDefCallback = this.props.onActivateCustomProcedures;
        this.ScratchBlocks.ScratchMsgs.setLocale(this.props.locale);

        const workspaceConfig = defaultsDeep({},
            Blocks.defaultOptions,
            this.props.options,
            {rtl: this.props.isRtl, toolbox: this.props.toolboxXML, colours: getColorsForTheme(this.props.theme)}
        );
        this.workspace = this.ScratchBlocks.inject(this.blocks, workspaceConfig);
        const toolboxWorkspace = this.workspace.getFlyout().getWorkspace();

        const varListButtonCallback = type =>
            (() => this.ScratchBlocks.Variables.createVariable(this.workspace, null, type));
        const procButtonCallback = () => {
            this.ScratchBlocks.Procedures.createProcedureDefCallback_(this.workspace);
        };

        toolboxWorkspace.registerButtonCallback('MAKE_A_VARIABLE', varListButtonCallback(''));
        toolboxWorkspace.registerButtonCallback('MAKE_A_LIST', varListButtonCallback('list'));
        toolboxWorkspace.registerButtonCallback('MAKE_A_PROCEDURE', procButtonCallback);

        this._renderedToolboxXML = this.props.toolboxXML;
        this.setToolboxRefreshEnabled = this.workspace.setToolboxRefreshEnabled.bind(this.workspace);
        this.workspace.setToolboxRefreshEnabled = () => {
            this.setToolboxRefreshEnabled(false);
        };

        addFunctionListener(this.workspace, 'translate', this.onWorkspaceMetricsChange);
        addFunctionListener(this.workspace, 'zoom', this.onWorkspaceMetricsChange);

        this.attachVM();
        if (this.props.isVisible) {
            this.setLocale();
        }

        // Patch WebGL getContext for screenshots
        const canvas = document.querySelector('.stage-wrapper canvas');
        if (canvas && !canvas._patched) {
            const oldGetContext = canvas.getContext;
            canvas.getContext = function(type, attrs) {
                if (type === 'webgl' || type === 'experimental-webgl') {
                    return oldGetContext.call(this, type, {
                        preserveDrawingBuffer: true,
                        ...attrs
                    });
                }
                return oldGetContext.call(this, type, attrs);
            };
            canvas._patched = true;
        }
    }

    shouldComponentUpdate (nextProps, nextState) {
        return (
            this.state.prompt !== nextState.prompt ||
            this.props.isVisible !== nextProps.isVisible ||
            this._renderedToolboxXML !== nextProps.toolboxXML ||
            this.props.extensionLibraryVisible !== nextProps.extensionLibraryVisible ||
            this.props.customProceduresVisible !== nextProps.customProceduresVisible ||
            this.props.locale !== nextProps.locale ||
            this.props.anyModalVisible !== nextProps.anyModalVisible ||
            this.props.stageSize !== nextProps.stageSize ||
            this.state.showGeminiChat !== nextState.showGeminiChat ||
            this.state.includeScreenshot !== nextState.includeScreenshot ||
            this.state.geminiOutput !== nextState.geminiOutput ||
            this.state.submitting !== nextState.submitting
        );
    }

    componentDidUpdate (prevProps) {
        if (this.props.anyModalVisible && !prevProps.anyModalVisible) {
            this.ScratchBlocks.hideChaff();
        }
        if (this.props.isVisible && this.props.toolboxXML !== this._renderedToolboxXML) {
            this.requestToolboxUpdate();
        }
        if (this.props.isVisible === prevProps.isVisible) {
            if (this.props.stageSize !== prevProps.stageSize) {
                window.dispatchEvent(new Event('resize'));
            }
            return;
        }
        if (this.props.isVisible) {
            this.workspace.setVisible(true);
            if (prevProps.locale !== this.props.locale || this.props.locale !== this.props.vm.getLocale()) {
                this.setLocale();
            } else {
                this.props.vm.refreshWorkspace();
                this.requestToolboxUpdate();
            }
            window.dispatchEvent(new Event('resize'));
        } else {
            this.workspace.setVisible(false);
        }
    }

    componentWillUnmount () {
        this.detachVM();
        this.workspace.dispose();
        clearTimeout(this.toolboxUpdateTimeout);
        this.props.vm.clearFlyoutBlocks();
    }

    requestToolboxUpdate () {
        clearTimeout(this.toolboxUpdateTimeout);
        this.toolboxUpdateTimeout = setTimeout(() => {
            this.updateToolbox();
        }, 0);
    }

    setLocale () {
        this.ScratchBlocks.ScratchMsgs.setLocale(this.props.locale);
        this.props.vm.setLocale(this.props.locale, this.props.messages)
            .then(() => {
                this.workspace.getFlyout().setRecyclingEnabled(false);
                this.props.vm.refreshWorkspace();
                this.requestToolboxUpdate();
                this.withToolboxUpdates(() => {
                    this.workspace.getFlyout().setRecyclingEnabled(true);
                });
            });
    }

    updateToolbox () {
        this.toolboxUpdateTimeout = false;
        const categoryId = this.workspace.toolbox_.getSelectedCategoryId();
        const offset = this.workspace.toolbox_.getCategoryScrollOffset();
        this.workspace.updateToolbox(this.props.toolboxXML);
        this._renderedToolboxXML = this.props.toolboxXML;
        this.workspace.toolboxRefreshEnabled_ = true;

        const currentCategoryPos = this.workspace.toolbox_.getCategoryPositionById(categoryId);
        const currentCategoryLen = this.workspace.toolbox_.getCategoryLengthById(categoryId);
        if (offset < currentCategoryLen) {
            this.workspace.toolbox_.setFlyoutScrollPos(currentCategoryPos + offset);
        } else {
            this.workspace.toolbox_.setFlyoutScrollPos(currentCategoryPos);
        }

        const queue = this.toolboxUpdateQueue;
        this.toolboxUpdateQueue = [];
        queue.forEach(fn => fn());
    }

    withToolboxUpdates (fn) {
        if (this.toolboxUpdateTimeout) {
            this.toolboxUpdateQueue.push(fn);
        } else {
            fn();
        }
    }

    attachVM () {
        this.workspace.addChangeListener(this.props.vm.blockListener);
        this.flyoutWorkspace = this.workspace.getFlyout().getWorkspace();
        this.flyoutWorkspace.addChangeListener(this.props.vm.flyoutBlockListener);
        this.flyoutWorkspace.addChangeListener(this.props.vm.monitorBlockListener);
        this.props.vm.addListener('SCRIPT_GLOW_ON', this.onScriptGlowOn);
        this.props.vm.addListener('SCRIPT_GLOW_OFF', this.onScriptGlowOff);
        this.props.vm.addListener('BLOCK_GLOW_ON', this.onBlockGlowOn);
        this.props.vm.addListener('BLOCK_GLOW_OFF', this.onBlockGlowOff);
        this.props.vm.addListener('VISUAL_REPORT', this.onVisualReport);
        this.props.vm.addListener('workspaceUpdate', this.onWorkspaceUpdate);
        this.props.vm.addListener('targetsUpdate', this.onTargetsUpdate);
        this.props.vm.addListener('MONITORS_UPDATE', this.handleMonitorsUpdate);
        this.props.vm.addListener('EXTENSION_ADDED', this.handleExtensionAdded);
        this.props.vm.addListener('BLOCKSINFO_UPDATE', this.handleBlocksInfoUpdate);
        this.props.vm.addListener('PERIPHERAL_CONNECTED', this.handleStatusButtonUpdate);
        this.props.vm.addListener('PERIPHERAL_DISCONNECTED', this.handleStatusButtonUpdate);
    }

    detachVM () {
        this.props.vm.removeListener('SCRIPT_GLOW_ON', this.onScriptGlowOn);
        this.props.vm.removeListener('SCRIPT_GLOW_OFF', this.onScriptGlowOff);
        this.props.vm.removeListener('BLOCK_GLOW_ON', this.onBlockGlowOn);
        this.props.vm.removeListener('BLOCK_GLOW_OFF', this.onBlockGlowOff);
        this.props.vm.removeListener('VISUAL_REPORT', this.onVisualReport);
        this.props.vm.removeListener('workspaceUpdate', this.onWorkspaceUpdate);
        this.props.vm.removeListener('targetsUpdate', this.onTargetsUpdate);
        this.props.vm.removeListener('MONITORS_UPDATE', this.handleMonitorsUpdate);
        this.props.vm.removeListener('EXTENSION_ADDED', this.handleExtensionAdded);
        this.props.vm.removeListener('BLOCKSINFO_UPDATE', this.handleBlocksInfoUpdate);
        this.props.vm.removeListener('PERIPHERAL_CONNECTED', this.handleStatusButtonUpdate);
        this.props.vm.removeListener('PERIPHERAL_DISCONNECTED', this.handleStatusButtonUpdate);
    }

    updateToolboxBlockValue (id, value) {
        this.withToolboxUpdates(() => {
            const block = this.workspace
                .getFlyout()
                .getWorkspace()
                .getBlockById(id);
            if (block) {
                block.inputList[0].fieldRow[0].setValue(value);
            }
        });
    }

    onTargetsUpdate () {
        if (this.props.vm.editingTarget && this.workspace.getFlyout()) {
            ['glide', 'move', 'set'].forEach(prefix => {
                this.updateToolboxBlockValue(`${prefix}x`, Math.round(this.props.vm.editingTarget.x).toString());
                this.updateToolboxBlockValue(`${prefix}y`, Math.round(this.props.vm.editingTarget.y).toString());
            });
        }
    }

    onWorkspaceMetricsChange () {
        const target = this.props.vm.editingTarget;
        if (target && target.id) {
            setTimeout(() => {
                this.props.updateMetrics({
                    targetID: target.id,
                    scrollX: this.workspace.scrollX,
                    scrollY: this.workspace.scrollY,
                    scale: this.workspace.scale
                });
            }, 0);
        }
    }

    onScriptGlowOn (data) {
        this.workspace.glowStack(data.id, true);
    }

    onScriptGlowOff (data) {
        this.workspace.glowStack(data.id, false);
    }

    onBlockGlowOn (data) {
        this.workspace.glowBlock(data.id, true);
    }

    onBlockGlowOff (data) {
        this.workspace.glowBlock(data.id, false);
    }

    onVisualReport (data) {
        this.workspace.reportValue(data.id, data.value);
    }

    getToolboxXML () {
        try {
            let {editingTarget: target, runtime} = this.props.vm;
            const stage = runtime.getTargetForStage();
            if (!target) target = stage;
            const stageCostumes = stage.getCostumes();
            const targetCostumes = target.getCostumes();
            const targetSounds = target.getSounds();
            const dynamicBlocksXML = injectExtensionCategoryTheme(
                this.props.vm.runtime.getBlocksXML(target),
                this.props.theme
            );
            return makeToolboxXML(false, target.isStage, target.id, dynamicBlocksXML,
                targetCostumes[targetCostumes.length - 1].name,
                stageCostumes[stageCostumes.length - 1].name,
                targetSounds.length > 0 ? targetSounds[targetSounds.length - 1].name : '',
                getColorsForTheme(this.props.theme)
            );
        } catch {
            return null;
        }
    }

    onWorkspaceUpdate (data) {
        const toolboxXML = this.getToolboxXML();
        if (toolboxXML) {
            this.props.updateToolboxState(toolboxXML);
        }
        if (this.props.vm.editingTarget && !this.props.workspaceMetrics.targets[this.props.vm.editingTarget.id]) {
            this.onWorkspaceMetricsChange();
        }
        this.workspace.removeChangeListener(this.props.vm.blockListener);
        const dom = this.ScratchBlocks.Xml.textToDom(data.xml);
        try {
            this.ScratchBlocks.Xml.clearWorkspaceAndLoadFromXml(dom, this.workspace);
        } catch (error) {
            if (error.message) {
                error.message = `Workspace Update Error: ${error.message}`;
            }
            log.error(error);
        }
        this.workspace.addChangeListener(this.props.vm.blockListener);
        if (this.props.vm.editingTarget && this.props.workspaceMetrics.targets[this.props.vm.editingTarget.id]) {
            const {scrollX, scrollY, scale} = this.props.workspaceMetrics.targets[this.props.vm.editingTarget.id];
            this.workspace.scrollX = scrollX;
            this.workspace.scrollY = scrollY;
            this.workspace.scale = scale;
            this.workspace.resize();
        }
        this.workspace.clearUndo();
    }

    handleMonitorsUpdate (monitors) {
        const flyout = this.workspace.getFlyout();
        for (const monitor of monitors.values()) {
            const blockId = monitor.get('id');
            const isVisible = monitor.get('visible');
            flyout.setCheckboxState(blockId, isVisible);
            const block = this.props.vm.runtime.monitorBlocks.getBlock(blockId);
            if (block) {
                block.isMonitored = isVisible;
            }
        }
    }

    handleExtensionAdded (categoryInfo) {
        const defineBlocks = blockInfoArray => {
            if (blockInfoArray && blockInfoArray.length > 0) {
                const staticBlocksJson = [];
                const dynamicBlocksInfo = [];
                blockInfoArray.forEach(blockInfo => {
                    if (blockInfo.info && blockInfo.info.isDynamic) {
                        dynamicBlocksInfo.push(blockInfo);
                    } else if (blockInfo.json) {
                        staticBlocksJson.push(injectExtensionBlockTheme(blockInfo.json, this.props.theme));
                    }
                });
                this.ScratchBlocks.defineBlocksWithJsonArray(staticBlocksJson);
                dynamicBlocksInfo.forEach(blockInfo => {
                    const extendedOpcode = `${categoryInfo.id}_${blockInfo.info.opcode}`;
                    const blockDefinition =
                        defineDynamicBlock(this.ScratchBlocks, categoryInfo, blockInfo, extendedOpcode);
                    this.ScratchBlocks.Blocks[extendedOpcode] = blockDefinition;
                });
            }
        };

        defineBlocks(
            Object.getOwnPropertyNames(categoryInfo.customFieldTypes)
                .map(fieldTypeName => categoryInfo.customFieldTypes[fieldTypeName].scratchBlocksDefinition));
        defineBlocks(categoryInfo.menus);
        defineBlocks(categoryInfo.blocks);

        const toolboxXML = this.getToolboxXML();
        if (toolboxXML) {
            this.props.updateToolboxState(toolboxXML);
        }
    }

    handleBlocksInfoUpdate (categoryInfo) {
        this.handleExtensionAdded(categoryInfo);
    }

    handleCategorySelected (categoryId) {
        const extension = extensionData.find(ext => ext.extensionId === categoryId);
        if (extension && extension.launchPeripheralConnectionFlow) {
            this.handleConnectionModalStart(categoryId);
        }
        this.withToolboxUpdates(() => {
            this.workspace.toolbox_.setSelectedCategoryById(categoryId);
        });
    }

    setBlocks (blocks) { this.blocks = blocks; }

    handlePromptStart (message, defaultValue, callback, optTitle, optVarType) {
        const p = {prompt: {callback, message, defaultValue}};
        p.prompt.title = optTitle ? optTitle :
            this.ScratchBlocks.Msg.VARIABLE_MODAL_TITLE;
        p.prompt.varType = typeof optVarType === 'string'
            ? optVarType : this.ScratchBlocks.SCALAR_VARIABLE_TYPE;
        p.prompt.showVariableOptions =
            optVarType !== this.ScratchBlocks.BROADCAST_MESSAGE_VARIABLE_TYPE &&
            p.prompt.title !== this.ScratchBlocks.Msg.RENAME_VARIABLE_MODAL_TITLE &&
            p.prompt.title !== this.ScratchBlocks.Msg.RENAME_LIST_MODAL_TITLE;
        p.prompt.showCloudOption =
            (optVarType === this.ScratchBlocks.SCALAR_VARIABLE_TYPE) && this.props.canUseCloud;
        this.setState(p);
    }

    handleConnectionModalStart (extensionId) {
        this.props.onOpenConnectionModal(extensionId);
    }

    handleStatusButtonUpdate () {
        this.ScratchBlocks.refreshStatusButtons(this.workspace);
    }

    handleOpenSoundRecorder () {
        this.props.onOpenSoundRecorder();
    }

    handlePromptCallback (input, variableOptions) {
        this.state.prompt.callback(
            input,
            this.props.vm.runtime.getAllVarNamesOfType(this.state.prompt.varType),
            variableOptions);
        this.handlePromptClose();
    }

    handlePromptClose () {
        this.setState({prompt: null});
    }

    handleCustomProceduresClose (data) {
        this.props.onRequestCloseCustomProcedures(data);
        const ws = this.workspace;
        ws.refreshToolboxSelection_();
        ws.toolbox_.scrollToCategoryById('myBlocks');
    }

    handleDrop (dragInfo) {
        fetch(dragInfo.payload.bodyUrl)
            .then(response => response.json())
            .then(blocks => this.props.vm.shareBlocksToTarget(blocks, this.props.vm.editingTarget.id))
            .then(() => {
                this.props.vm.refreshWorkspace();
                this.updateToolbox();
            });
    }

    toggleGeminiChat () {
        this.setState(prevState => ({ showGeminiChat: !prevState.showGeminiChat }));
    }

    render () {
        const {
            anyModalVisible,
            canUseCloud,
            customProceduresVisible,
            extensionLibraryVisible,
            options,
            stageSize,
            vm,
            isRtl,
            isVisible,
            onActivateColorPicker,
            onOpenConnectionModal,
            onOpenSoundRecorder,
            onRequestCloseExtensionLibrary,
            onRequestCloseCustomProcedures,
            toolboxXML,
            updateMetrics: updateMetricsProp,
            updateToolboxState,
            useCatBlocks,
            workspaceMetrics,
            ...props
        } = this.props;

        const filteredProps = Object.keys(props).reduce((acc, key) => {
            if (!['onActivateCustomProcedures'].includes(key)) acc[key] = props[key];
            return acc;
        }, {});

        return (
            <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                <div
                    onClick={this.toggleGeminiChat}
                    style={{
                        position: 'absolute',
                        top: 0,
                        left: 311.5,
                        right: 0,
                        backgroundColor: '#4B90FF',
                        color: 'white',
                        padding: '12px 0',
                        textAlign: 'center',
                        boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
                        fontWeight: 'bold',
                        fontSize: '16px',
                        zIndex: 10,
                        cursor: 'pointer',
                        borderTopLeftRadius: '6px',
                        borderTopRightRadius: '6px',
                        borderBottomLeftRadius: '18px',
                        borderBottomRightRadius: '18px'
                    }}
                >
                    {this.state.showGeminiChat ? '▲ Close Gemini Chat' : '▼ Talk to Gemini'}
                </div>

                {this.state.showGeminiChat && (
                    <div
                        style={{
                            position: 'absolute',
                            top: '50px',
                            left: 311.5,
                            right: 0,
                            height: 'calc(100% - 50px)',
                            backgroundColor: '#f0f0f0',
                            border: '1px solid #ccc',
                            borderRadius: '8px',
                            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                            zIndex: 10,
                            display: 'flex',
                            flexDirection: 'column',
                            padding: '10px'
                        }}
                    >
                        <div style={{
                            flexGrow: 1,
                            overflowY: 'auto',
                            marginBottom: '10px',
                            background: 'white',
                            padding: '10px',
                            borderRadius: '4px',
                            whiteSpace: 'pre-wrap' }}
                        >
                            {this.state.geminiOutput.map(chatItem => (
                                <div key={chatItem.id} style={{ marginBottom: '8px' }}>
                                    {chatItem.type === 'user' && (
                                        <strong style={{ color: '#007bff' }}>
                                            User: {chatItem.hasScreenshot && '(with screenshot) '}
                                        </strong>
                                    )}
                                    {chatItem.type === 'gemini' && <strong style={{ color: '#28a745' }}>Gemini: </strong>}
                                    {chatItem.type === 'gemini-thinking' && <strong style={{ color: '#6c757d' }}>{chatItem.message}</strong>}
                                    {chatItem.type !== 'gemini-thinking' && chatItem.message}
                                </div>
                            ))}
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: '#555' }}>
                                    <input
                                        type="checkbox"
                                        id="includeScreenshot"
                                        checked={this.state.includeScreenshot}
                                        onChange={this.handleIncludeScreenshotChange}
                                        style={{ transform: 'scale(1.2)' }}
                                    />
                                    Include screenshot with message
                                </label>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: '#555' }}>
                                    <input
                                        type="checkbox"
                                        id="canGeminiReadCode"
                                        checked={this.state.canGeminiReadCode}
                                        onChange={this.handleCanGeminiReadCodeChange}
                                        style={{ transform: 'scale(1.2)' }}
                                    />
                                    Allow Gemini to see my blocks (Best for debugging)
                                </label>
                            </div>
                            <div style={{ display: 'flex', gap: '5px' }}>
                                <input
                                    type="text"
                                    placeholder="Type your message..."
                                    onKeyDown={this.handleGeminiInputSubmit}
                                    ref={this.inputRef}
                                    style={{
                                        flexGrow: 1,
                                        padding: '8px',
                                        border: '1px solid #ccc',
                                        borderRadius: '4px',
                                        boxSizing: 'border-box'
                                    }}
                                />
                                <button
                                    onClick={this.handleGeminiInputSubmit}
                                    disabled={this.state.submitting}
                                    style={{
                                        padding: '8px 15px',
                                        backgroundColor: '#4B90FF',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '4px',
                                        cursor: this.state.submitting ? 'not-allowed' : 'pointer',
                                        flexShrink: 0
                                    }}
                                >
                                    Send
                                </button>

                            </div>
                        </div>
                    </div>
                )}

                <DroppableBlocks
                    componentRef={this.setBlocks}
                    onDrop={this.handleDrop}
                    {...filteredProps}
                />

                {this.state.prompt ? (
                    <Prompt
                        defaultValue={this.state.prompt.defaultValue}
                        isStage={vm.runtime.getEditingTarget().isStage}
                        showListMessage={this.state.prompt.varType === this.ScratchBlocks.LIST_VARIABLE_TYPE}
                        label={this.state.prompt.message}
                        showCloudOption={this.state.prompt.showCloudOption}
                        showVariableOptions={this.state.prompt.showVariableOptions}
                        title={this.state.prompt.title}
                        vm={vm}
                        onCancel={this.handlePromptClose}
                        onOk={this.handlePromptCallback}
                    />
                ) : null}

                {extensionLibraryVisible ? (
                    <ExtensionLibrary
                        vm={vm}
                        onCategorySelected={this.handleCategorySelected}
                        onRequestClose={onRequestCloseExtensionLibrary}
                    />
                ) : null}

                {customProceduresVisible ? (
                    <CustomProcedures
                        options={{ media: options.media }}
                        onRequestClose={this.handleCustomProceduresClose}
                    />
                ) : null}
            </div>
        );
    }
}

Blocks.propTypes = {
    anyModalVisible: PropTypes.bool,
    canUseCloud: PropTypes.bool,
    customProceduresVisible: PropTypes.bool,
    extensionLibraryVisible: PropTypes.bool,
    isRtl: PropTypes.bool,
    isVisible: PropTypes.bool,
    locale: PropTypes.string.isRequired,
    messages: PropTypes.objectOf(PropTypes.string),
    onActivateColorPicker: PropTypes.func,
    onActivateCustomProcedures: PropTypes.func,
    onOpenConnectionModal: PropTypes.func,
    onOpenSoundRecorder: PropTypes.func,
    onRequestCloseCustomProcedures: PropTypes.func,
    onRequestCloseExtensionLibrary: PropTypes.func,
    options: PropTypes.shape({
        media: PropTypes.string,
        zoom: PropTypes.shape({
            controls: PropTypes.bool,
            wheel: PropTypes.bool,
            startScale: PropTypes.number
        }),
        comments: PropTypes.bool,
        collapse: PropTypes.bool
    }),
    stageSize: PropTypes.oneOf(Object.keys(STAGE_DISPLAY_SIZES)).isRequired,
    theme: PropTypes.oneOf(Object.keys(themeMap)),
    toolboxXML: PropTypes.string,
    updateMetrics: PropTypes.func,
    updateToolboxState: PropTypes.func,
    useCatBlocks: PropTypes.bool,
    vm: PropTypes.instanceOf(VM).isRequired,
    workspaceMetrics: PropTypes.shape({
        targets: PropTypes.objectOf(PropTypes.object)
    })
};

Blocks.defaultOptions = {
    zoom: {
        controls: true,
        wheel: true,
        startScale: BLOCKS_DEFAULT_SCALE
    },
    grid: {
        spacing: 40,
        length: 2,
        colour: '#ddd'
    },
    comments: true,
    collapse: false,
    sounds: false
};

Blocks.defaultProps = {
    isVisible: true,
    options: Blocks.defaultOptions,
    theme: DEFAULT_THEME
};

const mapStateToProps = state => ({
    anyModalVisible: (
        Object.keys(state.scratchGui.modals).some(key => state.scratchGui.modals[key]) ||
        state.scratchGui.mode.isFullScreen
    ),
    extensionLibraryVisible: state.scratchGui.modals.extensionLibrary,
    isRtl: state.locales.isRtl,
    locale: state.locales.locale,
    messages: state.locales.messages,
    toolboxXML: state.scratchGui.toolbox.toolboxXML,
    customProceduresVisible: state.scratchGui.customProcedures.active,
    workspaceMetrics: state.scratchGui.workspaceMetrics,
    useCatBlocks: isTimeTravel2020(state)
});

const mapDispatchToProps = dispatch => ({
    onActivateColorPicker: callback => dispatch(activateColorPicker(callback)),
    onActivateCustomProcedures: (data, callback) => dispatch(activateCustomProcedures(data, callback)),
    onOpenConnectionModal: id => {
        dispatch(setConnectionModalExtensionId(id));
        dispatch(openConnectionModal());
    },
    onOpenSoundRecorder: () => {
        dispatch(activateTab(SOUNDS_TAB_INDEX));
        dispatch(openSoundRecorder());
    },
    onRequestCloseExtensionLibrary: () => {
        dispatch(closeExtensionLibrary());
    },
    onRequestCloseCustomProcedures: () => dispatch(deactivateCustomProcedures()),
    updateToolboxState: toolboxXML => dispatch(updateToolbox(toolboxXML)),
    updateMetrics: metrics => dispatch(updateMetrics(metrics))
});

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(Blocks);
