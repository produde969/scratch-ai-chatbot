import bindAll from 'lodash.bindall';
import PropTypes from 'prop-types';
import React from 'react';
import {injectIntl, intlShape, defineMessages} from 'react-intl';
import LibraryComponent from '../components/library/library.jsx';
import backdropLibraryContent from '../lib/libraries/local-backdrops.json';
import backdropTags from '../lib/libraries/backdrop-tags';

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
        bindAll(this, ['handleItemSelect']);
    }

    async handleItemSelect(item) {
        console.log('[BackdropLibrary] onItemSelected →', item);
        const {md5ext, name, dataFormat} = item;
        const storageModule = this.props.vm.runtime.storage;
        const assetType = dataFormat === 'svg'
            ? storageModule.AssetType.ImageVector
            : storageModule.AssetType.ImageBitmap;

        try {
            // Fetch the raw bytes
            const url = `/static/backdrops/${md5ext}`;
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
            const buffer = await response.arrayBuffer();
            const dataBytes = new Uint8Array(buffer);

            // Create asset with runtimeFormat=false (partial decode)
            const asset = storageModule.createAsset(
                assetType,
                dataFormat,
                dataBytes,
                md5ext.split('.')[0],
                false
            );

            // Only top-left portion shows because no explicit size = VM uses whatever gets decoded
            const backdropObject = {
                asset,
                name,
                rotationCenterX: 480,
                rotationCenterY: 360,
                bitmapResolution: 6
            };

            await this.props.vm.addBackdrop(md5ext, backdropObject);
            if (this.props.vm.renderer) this.props.vm.renderer.draw();
        } catch (error) {
            console.error('[BackdropLibrary] ❌ Error loading backdrop:', error);
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
    vm: PropTypes.object.isRequired
};

export default injectIntl(BackdropLibrary);
