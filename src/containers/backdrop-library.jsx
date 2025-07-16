//backdrop-library.jsx

import bindAll from 'lodash.bindall';
import PropTypes from 'prop-types';
import React from 'react';
import { injectIntl, intlShape, defineMessages } from 'react-intl';
import VM from 'scratch-vm';

import backdropLibraryContent from '../lib/libraries/backdrops.json';
import backdropTags from '../lib/libraries/backdrop-tags';
import LibraryComponent from '../components/library/library.jsx';

const messages = defineMessages({
    libraryTitle: {
        defaultMessage: 'Choose a Backdrop',
        description: 'Heading for the backdrop library',
        id: 'gui.backdropLibrary.chooseABackdrop'
    }
});

class BackdropLibrary extends React.PureComponent {
    constructor(props) {
        super(props);
        bindAll(this, [
            'handleItemSelect'
        ]);
    }

    async handleItemSelect(item) {
        console.log("[BackdropLibrary] onItemSelected →", item);

        try {
            const costumeUrl = `https://cdn.assets.scratch.mit.edu/internalapi/asset/${item.md5ext}/get/`;
            const response = await fetch(costumeUrl);
            const blob = await response.blob();
            console.log("[BackdropLibrary] blob from fetch:", blob);
            console.log("[BackdropLibrary] blob type:", blob.type);

            const extension = item.md5ext.split('.').pop();
            const filename = `${item.name}.${extension}`;

            let correctedType = blob.type;
            if (correctedType === 'application/octet-stream') {
                if (item.dataFormat === 'png') {
                    correctedType = 'image/png';
                } else if (item.dataFormat === 'svg') {
                    correctedType = 'image/svg+xml';
                }
            }

            const file = new File([blob], filename, { type: correctedType });
            console.log("[BackdropLibrary] constructed File:", file);

            const stage = this.props.vm.runtime.getTargetForStage();
            console.log("[BackdropLibrary] adding to stage ID:", stage.id);

            const reader = new FileReader();

            reader.onload = async (e) => {
                try {
                    const contents = item.dataFormat === 'svg'
                        ? e.target.result
                        : new Uint8Array(e.target.result);

                    const costumeObject = {
                        name: item.name,
                        assetId: item.assetId,
                        md5ext: item.md5ext,
                        dataFormat: item.dataFormat,
                        bitmapResolution: item.bitmapResolution,
                        rotationCenterX: item.rotationCenterX,
                        rotationCenterY: item.rotationCenterY
                    };

                    console.log("[BackdropLibrary] reader.result type:", typeof contents, contents);

                    await this.props.vm.addBackdrop(costumeObject, contents, stage.id);

                    console.log("[BackdropLibrary] Backdrop added to stage");
                    this.props.onRequestClose();
                } catch (err) {
                    console.error("[BackdropLibrary] Error adding backdrop:", err);
                }
            };

            if (item.dataFormat === 'svg') {
                reader.readAsText(file);
            } else {
                reader.readAsArrayBuffer(file);
            }

        } catch (err) {
            console.error("[BackdropLibrary] Failed to import backdrop:", err);
        }
    }

    render() {
        return (
            <LibraryComponent
                data={backdropLibraryContent}
                id="backdropLibrary"
                tags={backdropTags}
                title={this.props.intl.formatMessage(messages.libraryTitle)}
                onItemSelected={this.handleItemSelect}
                onRequestClose={this.props.onRequestClose}
            />
        );
    }
}

BackdropLibrary.propTypes = {
    intl: intlShape.isRequired,
    onRequestClose: PropTypes.func,
    vm: PropTypes.instanceOf(VM).isRequired
};

export default injectIntl(BackdropLibrary);

