// vm-manager-hoc.jsx
import bindAll from 'lodash.bindall';
import PropTypes from 'prop-types';
import React from 'react';
import {connect} from 'react-redux';

import VM from 'scratch-vm-for-gemini-chatbot';
import AudioEngine from 'scratch-audio';

import {setProjectUnchanged} from '../reducers/project-changed';
import {
    LoadingStates,
    getIsLoadingWithId,
    onLoadedProject,
    projectError
} from '../reducers/project-state';

const vmManagerHOC = function (WrappedComponent) {
    class VMManager extends React.Component {
        constructor(props) {
            super(props);
            bindAll(this, ['loadProject']);
        }

        componentDidMount() {
            if (!this.props.vm.initialized) {
                this.audioEngine = new AudioEngine();
                this.props.vm.attachAudioEngine(this.audioEngine);

                try {
                    if (!this.props.vm.runtime.storage) {
                        console.warn('[vm-manager-hoc] Storage module is not defined. Initializing storage...');
                        const ScratchStorage = require('scratch-storage');
                        const assetStorage = new ScratchStorage();

                        // Remote Scratch CDN assets (projects & vector costumes)
                        assetStorage.addWebStore(
                            [
                                ScratchStorage.AssetType.Project,
                                ScratchStorage.AssetType.ImageVector
                            ],
                            ({assetId, dataFormat}) =>
                                `https://assets.scratch.mit.edu/internalapi/asset/${assetId}.${dataFormat}/get/`
                        );

                        // Local backdrops (PNG & SVG)
                        assetStorage.addWebStore(
                            [
                                ScratchStorage.AssetType.ImageBitmap,
                                ScratchStorage.AssetType.ImageVector
                            ],
                            ({assetId, dataFormat}) =>
                                `/static/backdrops/${assetId}.${dataFormat}`
                        );

                        // Attach storage to the VM and runtime
                        this.props.vm.attachStorage(assetStorage);
                        this.props.vm.runtime.attachStorage(assetStorage);
                        console.log('[vm-manager-hoc] Storage attached:', assetStorage);
                    }
                } catch (err) {
                    console.error('[vm-manager-hoc] Failed to attach storage:', err);
                }

                this.props.vm.setCompatibilityMode(true);
                this.props.vm.initialized = true;
                this.props.vm.setLocale(this.props.locale, this.props.messages);
            }

            if (!this.props.isPlayerOnly && !this.props.isStarted) {
                this.props.vm.start();
            }
        }

        componentDidUpdate(prevProps) {
            if (this.props.isLoadingWithId && this.props.fontsLoaded &&
                (!prevProps.isLoadingWithId || !prevProps.fontsLoaded)) {
                this.loadProject();
            }
            if (!this.props.isPlayerOnly && !this.props.isStarted) {
                this.props.vm.start();
            }
        }

        loadProject() {
            return this.props.vm.loadProject(this.props.projectData)
                .then(() => {
                    this.props.onLoadedProject(this.props.loadingState, this.props.canSave);
                    setTimeout(() => this.props.onSetProjectUnchanged());
                    if (!this.props.isStarted && this.props.vm.renderer) {
                        setTimeout(() => this.props.vm.renderer.draw());
                    }
                })
                .catch(e => {
                    console.error('[vm-manager-hoc] Failed to load project:', e);
                    this.props.onError(e);
                });
        }

        render() {
            const {vm, ...componentProps} = this.props;
            return (
                <WrappedComponent
                    isLoading={this.props.isLoadingWithId}
                    vm={vm}
                    {...componentProps}
                />
            );
        }
    }

    VMManager.propTypes = {
        canSave: PropTypes.bool,
        cloudHost: PropTypes.string,
        fontsLoaded: PropTypes.bool,
        isLoadingWithId: PropTypes.bool,
        isPlayerOnly: PropTypes.bool,
        isStarted: PropTypes.bool,
        loadingState: PropTypes.oneOf(LoadingStates),
        locale: PropTypes.string,
        messages: PropTypes.objectOf(PropTypes.string),
        onError: PropTypes.func,
        onLoadedProject: PropTypes.func,
        onSetProjectUnchanged: PropTypes.func,
        projectData: PropTypes.oneOfType([PropTypes.object, PropTypes.string]),
        projectId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
        username: PropTypes.string,
        vm: PropTypes.instanceOf(VM).isRequired
    };

    const mapStateToProps = state => {
        const loadingState = state.scratchGui.projectState.loadingState;
        return {
            fontsLoaded: state.scratchGui.fontsLoaded,
            isLoadingWithId: getIsLoadingWithId(loadingState),
            locale: state.locales.locale,
            messages: state.locales.messages,
            projectData: state.scratchGui.projectState.projectData,
            projectId: state.scratchGui.projectState.projectId,
            loadingState,
            isPlayerOnly: state.scratchGui.mode.isPlayerOnly,
            isStarted: state.scratchGui.vmStatus.started
        };
    };

    const mapDispatchToProps = dispatch => ({
        onError: error => dispatch(projectError(error)),
        onLoadedProject: (loadingState, canSave) =>
            dispatch(onLoadedProject(loadingState, canSave, true)),
        onSetProjectUnchanged: () => dispatch(setProjectUnchanged())
    });

    const mergeProps = (stateProps, dispatchProps, ownProps) =>
        Object.assign({}, stateProps, dispatchProps, ownProps);

    return connect(
        mapStateToProps,
        mapDispatchToProps,
        mergeProps
    )(VMManager);
};

export default vmManagerHOC;
