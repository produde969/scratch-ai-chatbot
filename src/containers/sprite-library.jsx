import bindAll from 'lodash.bindall';
import PropTypes from 'prop-types';
import React from 'react';
import {injectIntl, intlShape, defineMessages} from 'react-intl';
import VM from 'scratch-vm-for-gemini-chatbot';
;

import spriteLibraryContent from '../lib/libraries/sprites.json';
import randomizeSpritePosition from '../lib/randomize-sprite-position';
import spriteTags from '../lib/libraries/sprite-tags';

import LibraryComponent from '../components/library/library.jsx';

const messages = defineMessages({
    libraryTitle: {
        defaultMessage: 'Choose a Sprite',
        description: 'Heading for the sprite library',
        id: 'gui.spriteLibrary.chooseASprite'
    }
});

class SpriteLibrary extends React.PureComponent {
    constructor (props) {
        super(props);
        bindAll(this, [
            'handleItemSelect'
        ]);
    }

    async handleItemSelect(item) {
        console.log("[SpriteLibrary] onItemSelected →", item);
        try {
            randomizeSpritePosition(item);
    
            // 1. Download costume files
            const costumeFiles = await Promise.all(item.costumes.map(async (costume, index) => {
                const costumeUrl = `https://cdn.assets.scratch.mit.edu/internalapi/asset/${costume.md5ext}/get/`;
                const response = await fetch(costumeUrl);
                if (!response.ok) throw new Error(`Failed to fetch costume: ${costume.name}`);
                const blob = await response.blob();
                return new File([blob], `${costume.md5ext}`, { type: blob.type });
            }));
    
            // 2. Download sound files
            const soundFiles = await Promise.all((item.sounds || []).map(async (sound, index) => {
                const soundUrl = `https://cdn.assets.scratch.mit.edu/internalapi/asset/${sound.md5ext}/get/`;
                const response = await fetch(soundUrl);
                if (!response.ok) throw new Error(`Failed to fetch sound: ${sound.name}`);
                const blob = await response.blob();
                return new File([blob], `${sound.md5ext}`, { type: blob.type });
            }));
    
            // 3. Build sprite JSON
            const spriteJSON = {
                name: item.name,
                isStage: false,
                variables: {},
                lists: {},
                broadcasts: {},
                blocks: {},
                comments: {},
                currentCostume: 0,
                costumes: item.costumes.map(costume => ({
                    name: costume.name,
                    assetId: costume.md5ext.split('.')[0],
                    md5ext: costume.md5ext,
                    dataFormat: costume.dataFormat || costume.md5ext.split('.')[1],
                    bitmapResolution: costume.bitmapResolution || 1,
                    rotationCenterX: costume.rotationCenterX,
                    rotationCenterY: costume.rotationCenterY
                })),
                sounds: (item.sounds || []).map(sound => ({
                    name: sound.name,
                    assetId: sound.md5ext.split('.')[0],
                    format: sound.format || sound.md5ext.split('.')[1],
                    rate: sound.rate,
                    sampleCount: sound.sampleCount,
                    dataFormat: sound.format || sound.md5ext.split('.')[1],
                    md5ext: sound.md5ext
                })),
                volume: 100,
                layerOrder: 1,
                visible: true,
                x: item.x || 0,
                y: item.y || 0,
                size: item.size || 100,
                direction: item.direction || 90,
                draggable: false,
                rotationStyle: 'all around'
            };
    
            const jsonBlob = new Blob([JSON.stringify(spriteJSON)], { type: 'application/json' });
            const jsonFile = new File([jsonBlob], 'sprite.json');
    
            // 4. Combine all files
            const allFiles = [...costumeFiles, ...soundFiles, jsonFile];
            await this.props.vm.importSprite(allFiles, true);
    
            console.log("[SpriteLibrary] Sprite added using importSprite");
            this.props.onActivateBlocksTab();
        } catch (err) {
            console.error("[SpriteLibrary] Failed to import sprite:", err);
        }
    }
    

    render () {
        return (
            <LibraryComponent
                data={spriteLibraryContent}
                id="spriteLibrary"
                tags={spriteTags}
                title={this.props.intl.formatMessage(messages.libraryTitle)}
                onItemSelected={this.handleItemSelect}
                onRequestClose={this.props.onRequestClose}
            />
        );
    }
}

SpriteLibrary.propTypes = {
    intl: intlShape.isRequired,
    onActivateBlocksTab: PropTypes.func.isRequired,
    onRequestClose: PropTypes.func,
    vm: PropTypes.instanceOf(VM).isRequired
};

export default injectIntl(SpriteLibrary);