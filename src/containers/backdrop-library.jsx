

// containers/backdrop-library.jsx
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
        const assetType =
            dataFormat === 'svg'
                ? storageModule.AssetType.ImageVector
                : storageModule.AssetType.ImageBitmap;

        try {
            // Fetch raw data
            const url = `/static/backdrops/${md5ext}`;
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Network ${response.status} fetching ${url}`);
            const buffer = await response.arrayBuffer();
            const array = new Uint8Array(buffer);

            // Create asset with correct signature
            const asset = storageModule.createAsset(
                assetType,
                dataFormat,
                array,
                md5ext.split('.')[0],
                false
            );

            // Build costume/backdrop object
            const costumeObject = {
                name,
                asset,
                dataFormat: storageModule.DataFormat.PNG,
                rotationCenterX: 240,
                rotationCenterY: 180,
                bitmapResolution: 1,
                size: [480, 360]
            };

            // Add backdrop and redraw
            await this.props.vm.addBackdrop(md5ext, costumeObject);
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
