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
import {connect} from 'react-redux'; // Make sure connect is imported
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
import { GoogleGenerativeAI } from '@google/generative-ai'; // This import is not used directly here, as the model is initialized via fetch.
import html2canvas from 'html2canvas'; // This import is not used directly here, as the screenshot function is custom.

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

// It's important to keep API keys secure. For a real application,
// you would use a backend to handle API calls.
// For this example, we'll assume REACT_APP_GEMINI_API_KEY is available
// in the environment for demonstration purposes.
// Note: This GEMINI_API_KEY is not directly used in this file as API calls are proxied through the backend.
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
            'handleAnalyzeNextMove' // Bind the new handler
        ]);
        this.ScratchBlocks.prompt = this.handlePromptStart;
        this.ScratchBlocks.statusButtonCallback = this.handleConnectionModalStart;
        this.ScratchBlocks.recordSoundCallback = this.handleOpenSoundRecorder;
        this.state = {
            prompt: null,
            showGeminiChat: false,
            geminiInput: '',
            geminiOutput: [],
            includeScreenshot: false, // New state for screenshot option
            submitting: false // New state to prevent double submission
        };
        this.onTargetsUpdate = debounce(this.onTargetsUpdate, 100);
        this.toolboxUpdateQueue = [];
        this.geminiModel = null;
        this.initializeGemini();
        this.inputRef = React.createRef();
    }

    // This lifecycle method is used to keep the cursor at the end of the input
    // when the Gemini chat is open and the input changes.
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

    // Initializes the Gemini AI model using the provided API key.
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
                    response: {
                        text: () => data.message
                    }
                };
            }
        };
    }

    // Handles changes to the Gemini input text field.
    handleGeminiInputChange(e) {
        this.setState({ geminiInput: e.target.value });
    }

    // Handles changes to the "Include Screenshot" checkbox.
    handleIncludeScreenshotChange(e) {
        this.setState({ includeScreenshot: e.target.checked });
    }

    // Handles the submission of the Gemini input, either by Enter key or button click.
    async handleGeminiInputSubmit(e) {
        // Prevent default form submission behavior (e.g., if input is inside a form)
        // and prevent the click event from propagating if it's already handled by onKeyDown
        if (e.key === 'Enter' || e.type === 'click') {
            e.preventDefault();
        } else {
            // Only proceed if it's an Enter key press or a click event
            return;
        }

        const userInput = this.inputRef.current?.value.trim();
        if (!userInput) return;

        // Prevent double submission
        if (this.state.submitting) {
            console.log("Submission already in progress, ignoring.");
            return;
        }

        this.setState({ submitting: true }); // Set submitting flag

        // Generate unique IDs for messages
        const userMessageId = crypto.randomUUID();
        const thinkingMessageId = crypto.randomUUID();

        // Clear the input field immediately
        if (this.inputRef.current) this.inputRef.current.value = '';

        // Display user message and "Thinking..." message
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
                submitting: false // Reset submitting flag
            }));
            return;
        }

        let screenshotBase64 = null;
        if (this.state.includeScreenshot) {
            // Update user message to indicate screenshot is included
            this.setState(prevState => ({
                geminiOutput: prevState.geminiOutput.map(msg =>
                    msg.id === userMessageId
                        ? { ...msg, hasScreenshot: true }
                        : msg
                )
            }));
            screenshotBase64 = await captureCanvasScreenshotWithRetry();
        }

        // Extract VM context to provide to Gemini for better understanding.
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

        // Function to capture a screenshot of the Scratch canvas.
        // It retries multiple times to ensure a non-black image is captured.
        async function captureCanvasScreenshot() {
            try {
                // Select the main canvas element used by Scratch.
                const canvas = document.querySelector('.stage-wrapper canvas, .stage-and-target-wrapper canvas, .scratch-stage canvas, canvas');
                if (!canvas) {
                    console.warn("⚠️ WebGL canvas not found in known containers.");
                    return null;
                }

                // Flush WebGL context to ensure all drawing commands are executed.
                const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
                if (gl) gl.flush();

                // Wait for rendering to complete (two requestAnimationFrame calls)
                await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                // Add a small timeout for good measure, allowing the browser to fully render.
                await new Promise(resolve => setTimeout(resolve, 100));

                // Create an offscreen canvas to draw the screenshot.
                const offscreen = document.createElement('canvas');
                offscreen.width = canvas.width;
                offscreen.height = canvas.height;
                const ctx = offscreen.getContext('2d');
                ctx.drawImage(canvas, 0, 0);

                // Check if the captured image is entirely black (common issue with WebGL screenshots).
                const data = ctx.getImageData(0, 0, offscreen.width, offscreen.height).data;
                const isBlack = data.every((val, idx) => val === 0 || (idx + 1) % 4 === 0);
                if (isBlack) {
                    console.warn("⚠️ Screenshot is completely black.");
                }

                // Convert the canvas content to a base64 PNG data URL.
                const base64 = offscreen.toDataURL('image/png').split(',')[1];
                console.log("✅ Screenshot captured after render wait");
                return base64;
            } catch (err) {
                console.error("❌ Screenshot capture failed:", err);
                return null;
            }
        }

        // Retries screenshot capture to ensure a valid (non-black) image.
        async function captureCanvasScreenshotWithRetry(maxAttempts = 200, delay = 0.1) { // Reduced attempts and delay for better performance
            for (let attempt = 0; attempt < maxAttempts; attempt++) {
                const base64 = await captureCanvasScreenshot();
                if (base64) {
                    // Decode to check if image is not fully black
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
                    if (!isBlack) {
                        console.log(`✅ Successful screenshot on attempt ${attempt + 1}`);
                        return base64;
                    }
                }
                await new Promise(resolve => setTimeout(resolve, delay));
            }
            console.warn("⚠️ All screenshot attempts resulted in black images.");
            return null;
        }

        //if you would like to remove the filter, remove the filterInstruction and wrappedPrompt variables
        const filterInstruction = "You are a kind, caring, and helpful AI assistant. A child has entered the prompt I will be eventually giving you. Please ensure that your responses are all child safe and do not contain any terms that may harm the child in any way. If you are unsure about a response, please ask the child to clarify what they mean. Do not use any terms that may be considered inappropriate for children. If you are asked to do something that is not child safe, please refuse and explain why it is not appropriate while also not saying anything innapropriate for children. thank you very much for your help, here is their response. only respond to the prompt. USE THE SAME LOGIC IF GIVEN AN IMAGE, IF YOU DEEM AN IMAGE INNAPROPRIATE AND RECEIVE EVIDENCE THROUGH THE IMAGE THAT IT IS INNAPROPRIATE USE THE SAME LOGIC FROM RESPONSES ONTO THE IMAGE. Thank you once again for your help";

        const wrappedPrompt =
        `<text>${userInput}</text>\n` +
        `<send_to_gemini>${filterInstruction}</send_to_gemini>`;

        const parts = [{ text: userInput }];
        if (screenshotBase64) {
            parts.push({
                inlineData: {
                    mimeType: "image/png",
                    data: screenshotBase64
                }
            });
        }

        try {
            // Call the Gemini API to generate content.
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

            // Update state with Gemini's response, replacing the thinking message.
            this.setState(prevState => ({
                geminiOutput: prevState.geminiOutput.map(msg =>
                    msg.id === thinkingMessageId
                        ? { ...msg, type: 'gemini', message: text }
                        : msg
                ),
                submitting: false // Reset submitting flag
            }));
        } catch (error) {
            console.error("Gemini error:", error);
            // Display error message if the API call fails, replacing the thinking message.
            this.setState(prevState => ({
                geminiOutput: prevState.geminiOutput.map(msg =>
                    msg.id === thinkingMessageId
                        ? { ...msg, type: 'error', message: `Gemini: Error: ${error.message}` }
                        : msg
                ),
                submitting: false // Reset submitting flag
            }));
        }
    }

    async handleAnalyzeNextMove() {
        if (this.state.submitting) return;
        this.setState({ submitting: true });
    
        const userInput = "What is the best move? Please Write using  the following format, C4C5 is an example. C4 representing the starting square and  C5 representing the square that I want the  piece to go to. LOOK VERY CAREFULLY AT PIECE'S AND THEIR COORDINATES ON THE BOARD. ONLY PROVIDE THE NOTATION, NOTHING ELSE";
        const userMessageId = crypto.randomUUID();
        const thinkingMessageId = crypto.randomUUID();
    
        this.setState(prevState => ({
                geminiOutput: [
                    ...prevState.geminiOutput,
                    { id: userMessageId, type: 'user', message: '(Analyzing board...)', hasScreenshot: true, timestamp: Date.now() },
                { id: thinkingMessageId, type: 'gemini-thinking', message: 'Gemini: Thinking...', timestamp: Date.now() }
            ]
        }));
    
        const screenshotBase64 = await this.captureCanvasScreenshotWithRetry();
        const parts = [{ text: userInput }];
        if (screenshotBase64) {
            parts.push({
                inlineData: {
                    mimeType: "image/png",
                    data: screenshotBase64
                }
            });
        }
    
        try {
            const result = await this.geminiModel.generateContent({ contents: [{ role: 'user', parts }] });
            const text = result?.response?.text();
    
            this.setState(prevState => ({
                geminiOutput: prevState.geminiOutput.map(msg =>
                    msg.id === thinkingMessageId ? { ...msg, type: 'gemini', message: text } : msg
                ),
                submitting: false
            }));
        } catch (error) {
            console.error('Gemini error:', error);
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
    
    // Add the retry screenshot function to the class:
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
                if (!isBlack) {
                    console.log(`✅ Successful screenshot on attempt ${attempt + 1}`);
                    return base64;
                }
            }
            await new Promise(resolve => setTimeout(resolve, delay));
        }
        console.warn("⚠️ All screenshot attempts resulted in black images.");
        return null;
    };
    
    // Add the screenshot capture function to the class:
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
            if (isBlack) {
                console.warn("⚠️ Screenshot is completely black.");
            }
    
            const base64 = offscreen.toDataURL('image/png').split(',')[1];
            console.log("✅ Screenshot captured after render wait");
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

        // Patch the canvas getContext to preserve drawing buffer,
        // which is necessary for screenshot capture.
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
        // Optimize re-renders by checking only relevant props and state.
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
            this.state.includeScreenshot !== nextState.includeScreenshot || // Include new state
            this.state.geminiOutput !== nextState.geminiOutput || // Include geminiOutput for chat updates
            this.state.submitting !== nextState.submitting // Include submitting state
        );
    }

    componentDidUpdate (prevProps) {
        // Hide ScratchBlocks chaff (e.g., context menus) when any modal is visible.
        if (this.props.anyModalVisible && !prevProps.anyModalVisible) {
            this.ScratchBlocks.hideChaff();
        }
        // Request toolbox update if visibility is true and toolbox XML has changed.
        if (this.props.isVisible && this.props.toolboxXML !== this._renderedToolboxXML) {
            this.requestToolboxUpdate();
        }
        // If visibility hasn't changed, but stage size has, dispatch resize event.
        if (this.props.isVisible === prevProps.isVisible) {
            if (this.props.stageSize !== prevProps.stageSize) {
                window.dispatchEvent(new Event('resize'));
            }
            return;
        }
        // Handle visibility changes for the workspace.
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
        this.flyoutWorkspace = this.workspace
            .getFlyout()
            .getWorkspace();
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

    setBlocks (blocks) {
        this.blocks = blocks;
    }

    handlePromptStart (message, defaultValue, callback, optTitle, optVarType) {
        const p = {prompt: {callback, message, defaultValue}};
        p.prompt.title = optTitle ? optTitle :
            this.ScratchBlocks.Msg.VARIABLE_MODAL_TITLE;
        p.prompt.varType = typeof optVarType === 'string' ?
            optVarType : this.ScratchBlocks.SCALAR_VARIABLE_TYPE;
        p.prompt.showVariableOptions =
            optVarType !== this.ScratchBlocks.BROADCAST_MESSAGE_VARIABLE_TYPE &&
            p.prompt.title !== this.ScratchBlocks.Msg.RENAME_VARIABLE_MODAL_TITLE &&
            p.prompt.title !== this.ScratchBlocks.Msg.RENAME_LIST_MODAL_TITLE;
        p.prompt.showCloudOption = (optVarType === this.ScratchBlocks.SCALAR_VARIABLE_TYPE) && this.props.canUseCloud;
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

    // Toggles the visibility of the Gemini chat interface.
    toggleGeminiChat () {
        this.setState(prevState => ({
            showGeminiChat: !prevState.showGeminiChat
        }));
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
            updateToolboxState, // Destructure this prop so it's not passed to DOM element
            useCatBlocks,
            workspaceMetrics,
            ...props // Capture remaining props
        } = this.props;

        // Filter out props that are not valid for DOM elements
        const filteredProps = Object.keys(props).reduce((acc, key) => {
            if (!['onActivateCustomProcedures'].includes(key)) { // Add other props to filter if needed
                acc[key] = props[key];
            }
            return acc;
        }, {});

        return (
            <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                {/* Button to toggle Gemini chat visibility */}
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

                {/* Gemini Chat Interface */}
                {this.state.showGeminiChat && (
                    <div
                        style={{
                            position: 'absolute',
                            top: '50px', // Position below the toggle button
                            left: 311.5,
                            right: 0,
                            height: 'calc(100% - 50px)', // Adjust height
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
                        {/* Chat output area */}
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

                        {/* Input field and screenshot option */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <input
                                    type="checkbox"
                                    id="includeScreenshot"
                                    checked={this.state.includeScreenshot}
                                    onChange={this.handleIncludeScreenshotChange}
                                    style={{ transform: 'scale(1.2)' }}
                                />
                                <label htmlFor="includeScreenshot" style={{ fontSize: '14px', color: '#555' }}>
                                    Include screenshot with message
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
                                    // Disable button while submitting to prevent multiple clicks
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
                                <button
                                onClick={this.handleAnalyzeNextMove}
                                disabled={this.state.submitting}
                                style={{
                                    marginTop: '10px',
                                    padding: '8px 15px',
                                    backgroundColor: '#28a745',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: this.state.submitting ? 'not-allowed' : 'pointer',
                                    width: 'fit-content'
                                }}
                            >
                                Gemini Makes Move
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

//Export the connected component as default
export default connect(
    mapStateToProps,
    mapDispatchToProps
)(Blocks);