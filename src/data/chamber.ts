import chamberFile from './levels/chamber.json';
import { checkLevel } from '../level/levelData';

// The central test chamber (5.3, decision 274), grey-boxed from layout.md pass 3: the hall, four floor entrances with
// alcoves where squads gather, the floor's cover by zone, and the upper level (server core, catwalks, observation ring,
// two stairs, Rook's climb). Built with the level format from 5.2 (`levels/chamber.json`) and tuned with its editor.
export const chamberLevel = checkLevel(chamberFile);
