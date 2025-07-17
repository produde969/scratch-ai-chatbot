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
            const costumeFiles = await Promise.all(item.costumes.map(async c => {
                const url = `https://cdn.assets.scratch.mit.edu/internalapi/asset/${c.md5ext}/get/`;
                const res = await fetch(url);
                if (!res.ok) throw new Error(`Failed to fetch costume ${c.name}`);
                const blob = await res.blob();
                return new File([blob], c.md5ext, {type: blob.type});
            }));

            // 2. Download sound files
            const allowedFormats = ["wav","wave","mp3"];
            const soundFiles = await Promise.all((item.sounds || []).map(async s => {
                const url = `https://cdn.assets.scratch.mit.edu/internalapi/asset/${s.md5ext}/get/`;
                const res = await fetch(url);
                if (!res.ok) throw new Error(`Failed to fetch sound ${s.name}`);
                const blob = await res.blob();
                // pick a valid dataFormat
                const df = allowedFormats.includes(s.dataFormat) ? s.dataFormat : "wav";
                return new File([blob], s.md5ext, {type: blob.type});
            }));

            // 3. Build sprite JSON with objName + normalized dataFormats
            const spriteJSON = {
                // SB2 needs objName:
                objName: item.name,
                name: item.name,
                isStage: false,
                variables: {},
                lists: {},
                broadcasts: {},
                blocks: {},
                comments: {},
                currentCostume: 0,
                costumes: item.costumes.map(c => ({
                    name: c.name,
                    assetId: c.md5ext.split(".")[0],
                    md5ext: c.md5ext,
                    dataFormat: c.dataFormat || c.md5ext.split(".")[1],
                    bitmapResolution: c.bitmapResolution || 1,
                    rotationCenterX: c.rotationCenterX,
                    rotationCenterY: c.rotationCenterY
                })),
                sounds: (item.sounds || []).map(s => {
                    // normalize
                    const fmt = allowedFormats.includes(s.dataFormat) ? s.dataFormat : "wav";
                    return {
                        name: s.name,
                        assetId: s.md5ext.split(".")[0],
                        md5ext: s.md5ext,
                        dataFormat: fmt,
                        format: fmt,
                        rate: s.rate,
                        sampleCount: s.sampleCount
                    };
                }),
                volume: 100,
                layerOrder: 1,
                visible: true,
                x: item.x || 0,
                y: item.y || 0,
                size: item.size || 100,
                direction: item.direction || 90,
                draggable: false,
                rotationStyle: "all around"
            };

            const jsonBlob = new Blob([JSON.stringify(spriteJSON)], {type: "application/json"});
            const jsonFile = new File([jsonBlob], "sprite.json");

            // 4. Combine + import
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