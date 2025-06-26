import bindAll from 'lodash.bindall';
import debounce from 'lodash.debounce';
import defaultsDeep from 'lodash.defaultsdeep';
import makeToolboxXML from '../lib/make-toolbox-xml';
import PropTypes from 'prop-types';
import React from 'react';
import VMScratchBlocks from '../lib/blocks';
import VM from 'scratch-vm';

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

import { GoogleGenerativeAI } from '@google/generative-ai';

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
            'handleGeminiInputSubmit'
        ]);
        this.ScratchBlocks.prompt = this.handlePromptStart;
        this.ScratchBlocks.statusButtonCallback = this.handleConnectionModalStart;
        this.ScratchBlocks.recordSoundCallback = this.handleOpenSoundRecorder;

        this.state = {
            prompt: null,
            showGeminiChat: false,
            geminiInput: '',
            geminiOutput: []
        };
        this.onTargetsUpdate = debounce(this.onTargetsUpdate, 100);
        this.toolboxUpdateQueue = [];

        this.geminiModel = null;
        this.initializeGemini();

        this.inputRef = React.createRef();
        
    }
    componentDidUpdate(prevProps, prevState) {
        // If the geminiInput state changed AND the chat is visible AND the input element exists
        if (this.state.geminiInput !== prevState.geminiInput &&
            this.state.showGeminiChat &&
            this.inputRef.current) {
            // Keep the cursor at the end of the text and force focus
            const input = this.inputRef.current;
            const currentLength = input.value.length;
            input.setSelectionRange(currentLength, currentLength);
            input.focus();
        }
    }
    initializeGemini() {
        if (!GEMINI_API_KEY) {
            console.error("Gemini API Key is missing! Please check your .env file.");
            return;
        }
        try {
            const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
            this.geminiModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
            console.log("Gemini AI model initialized successfully!");
        } catch (error) {
            console.error("Failed to initialize Gemini AI model:", error);
        }
    }
    handleGeminiInputChange(e) {
        this.setState({ geminiInput: e.target.value });
        //for troubleshoot purposes
        console.log('Input changed:', e.target.value);
    }
    
    async handleGeminiInputSubmit(e) { 
        if (e.key === 'Enter' || e.type === 'click') {
            e.preventDefault();

            const userInput = this.inputRef.current ? this.inputRef.current.value.trim() : '';

            if (userInput) {
                console.log("User submitted:", userInput);

                // Update UI immediately with user's message
                this.setState(prevState => ({
                    geminiOutput: [
                        ...prevState.geminiOutput,
                        { type: 'user', message: userInput, timestamp: Date.now() } // Add message object
                    ]
                }));
                this.forceUpdate();

                // Clear the input field manually through the ref
                if (this.inputRef.current) {
                    this.inputRef.current.value = '';
                }

                if (!this.geminiModel) {
                    console.error("Gemini AI model is not initialized!");
                    this.setState(prevState => ({
                        geminiOutput: [
                            ...prevState.geminiOutput,
                            { type: 'error', message: 'Gemini: Error: Model not initialized.', timestamp: Date.now() }
                        ]
                    }));
                    this.forceUpdate();
                    return;
                }

                try {
                    this.setState(prevState => ({
                        geminiOutput: [
                            ...prevState.geminiOutput,
                            { type: 'gemini-thinking', message: 'Gemini: Thinking...', timestamp: Date.now() + 1 } // Unique timestamp
                        ]
                    }));
                    this.forceUpdate();

                    // Send the message to the Gemini API
                    const result = await this.geminiModel.generateContent(userInput);
                    const response = await result.response;
                    const text = response.text();

                    console.log("Gemini response:", text);

                    //replace "Thinking..." with Gemini response
                    this.setState(prevState => {
                        const updatedOutput = prevState.geminiOutput.map(msg => {
                            // Find the last 'gemini-thinking' message and replace it
                            if (msg.type === 'gemini-thinking' && msg.message === 'Gemini: Thinking...' && msg.timestamp > (Date.now() - 5000)) { // Simple check for recent "thinking"
                                return { type: 'gemini', message: text, timestamp: msg.timestamp };
                            }
                            return msg;
                        });

                        // If for some reason 'thinking' wasn't found/replaced, just append
                        if (!updatedOutput.find(msg => msg.type === 'gemini' && msg.message === text)) {
                            return { geminiOutput: [...prevState.geminiOutput, { type: 'gemini', message: text, timestamp: Date.now() }] };
                        }

                        return { geminiOutput: updatedOutput };
                    });
                    this.forceUpdate();

                } catch (error) {
                    console.error("Error calling Gemini API:", error);
                    // Update geminiOutput with an error message
                    this.setState(prevState => ({
                        geminiOutput: [
                            ...prevState.geminiOutput.filter(msg => msg.type !== 'gemini-thinking'), // Remove any pending thinking messages
                            { type: 'error', message: `Gemini: Error: ${error.message}`, timestamp: Date.now() }
                        ]
                    }));
                    this.forceUpdate();
                }
            }
        }
    }
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
            this.state.showGeminiChat !== nextState.showGeminiChat
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
            updateToolboxState,
            onActivateCustomProcedures,
            onRequestCloseExtensionLibrary,
            onRequestCloseCustomProcedures,
            toolboxXML,
            updateMetrics: updateMetricsProp,
            useCatBlocks,
            workspaceMetrics,
            ...props
        } = this.props;
        console.log("RENDERING UI with geminiOutput:", this.state.geminiOutput);
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
                        zIndex: 1000,
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
                            zIndex: 999,
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
                            {this.state.geminiOutput.map((chatItem, index) => (
                                // IMPORTANT: Add a `key` prop for each item in the list
                                <div key={chatItem.timestamp || index} style={{ marginBottom: '8px' }}>
                                    {chatItem.type === 'user' && <strong style={{ color: '#007bff' }}>User: </strong>}
                                    {chatItem.type === 'gemini' && <strong style={{ color: '#28a745' }}>Gemini: </strong>}
                                    {chatItem.type === 'gemini-thinking' && <strong style={{ color: '#6c757d' }}>{chatItem.message}</strong>}
                                    {chatItem.type === 'error' && <strong style={{ color: '#dc3545' }}>Error: </strong>}
                                    {chatItem.type !== 'gemini-thinking' && chatItem.message} {/* Only display message for non-thinking types */}
                                </div>
                            ))}
                        </div>
                        <input
                            type="text"
                            placeholder="Type your message..."
                            onKeyDown= {this.handleGeminiInputSubmit} 
                            ref={this.inputRef}
                            style={{
                                width: '100%',
                                padding: '8px',
                                border: '1px solid #ccc',
                                borderRadius: '4px',
                                boxSizing: 'border-box'
                            }}
                        />
                        {
                        <button
                            onClick={this.handleGeminiInputSubmit}
                            style={{
                                padding: '8px 15px',
                                marginTop: '5px',
                                backgroundColor: '#4B90FF',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer'
                            }}
                        >
                            Send
                        </button>
                        }
                    </div>
                )}

                <DroppableBlocks
                    componentRef={this.setBlocks}
                    onDrop={this.handleDrop}
                    {...props}
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