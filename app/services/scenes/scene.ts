import { ServiceHelper, mutation } from '../stateful-service';
import { ScenesService } from './scenes';
import { Source, SourcesService, TSourceType } from '../sources';
import { ISceneItem, ISceneItemApi, SceneItem } from './scene-item';
import Utils from '../utils';
import * as obs from '../obs-api';
import electron from 'electron';
import { Inject } from '../../util/injector';

const { ipcRenderer } = electron;


export interface IScene {
  id: string;
  name: string;
  activeItemId: string;
  items: ISceneItem[];
}


export interface ISceneItemAddOptions {
  sceneItemId?: string; // A new ID will be assigned if one is not provided
}

export interface ISceneItemInfo {
  id: string;
  sourceId: string;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  visible: boolean;
  crop: ICrop;
  locked?: boolean;
  rotation?: number;
}

export interface ISceneApi extends IScene {
  getItem(sceneItemId: string): ISceneItemApi;
  getItems(): ISceneItemApi[];
  addSource(sourceId: string, options?: ISceneItemAddOptions): ISceneItemApi;
  createAndAddSource(name: string, type: TSourceType): ISceneItemApi;
  makeItemActive(sceneItemId: string): void;
  canAddSource(sourceId: string): boolean;
}


@ServiceHelper()
export class Scene implements ISceneApi {
  id: string;
  name: string;
  activeItemId: string;
  items: ISceneItem[];

  @Inject()
  private scenesService: ScenesService;

  @Inject()
  private sourcesService: SourcesService;

  private sceneState: IScene;

  constructor(sceneId: string) {
    this.sceneState = this.scenesService.state.scenes[sceneId];
    Utils.applyProxy(this, this.sceneState);
  }


  getObsScene(): obs.IScene {
    return obs.SceneFactory.fromName(this.name);
  }


  getItem(sceneItemId: string): SceneItem {
    const sceneItemModel = this.sceneState.items.find(sceneItemModel => sceneItemModel.sceneItemId === sceneItemId);
    return sceneItemModel ?
      new SceneItem(this.id, sceneItemModel.sceneItemId, sceneItemModel.sourceId) :
      null;
  }


  getItems(): SceneItem[] {
    return this.sceneState.items.map(sourceModel => {
      return this.getItem(sourceModel.sceneItemId);
    });
  }


  get inactiveSources(): SceneItem[] {
    return this.sceneState.items.filter(sourceModel => {
      return sourceModel.sceneItemId !== this.activeItemId;
    }).map(source => {
      return this.getItem(source.sceneItemId);
    });
  }


  get activeItem(): SceneItem {
    return this.getItem(this.activeItemId);
  }


  createAndAddSource(sourceName: string, type: TSourceType, settings?: Dictionary<any>): SceneItem {
    const source = this.sourcesService.createSource(sourceName, type, settings);
    return this.addSource(source.sourceId);
  }


  addSource(sourceId: string, options: ISceneItemAddOptions = {}): SceneItem {
    const source = this.sourcesService.getSource(sourceId);
    const sceneItemId = options.sceneItemId || ipcRenderer.sendSync('getUniqueId');

    let obsSceneItem: obs.ISceneItem;
    obsSceneItem = this.getObsScene().add(source.getObsInput());

    this.ADD_SOURCE_TO_SCENE(sceneItemId, source.sourceId, obsSceneItem.id);
    const sceneItem = this.getItem(sceneItemId);

    // Newly added sources are immediately active
    this.makeItemActive(sceneItemId);

    sceneItem.loadAttributes();

    this.scenesService.itemAdded.next(sceneItem.sceneItemState);
    return sceneItem;
  }


  remove(force?: boolean): IScene {
    return this.scenesService.removeScene(this.id, force);
  }


  removeItem(sceneItemId: string) {
    const sceneItem = this.getItem(sceneItemId);
    sceneItem.getObsSceneItem().remove();
    this.REMOVE_SOURCE_FROM_SCENE(sceneItemId);
    this.scenesService.itemRemoved.next(sceneItem.sceneItemState);
  }


  makeItemActive(sceneItemId: string) {
    const selectedItem = this.getItem(sceneItemId);
    this.getObsScene().getItems().forEach(obsSceneItem => {
      if (!selectedItem || selectedItem.obsSceneItemId !== obsSceneItem.id) {
        obsSceneItem.selected = false;
        return;
      }
      obsSceneItem.selected = true;
    });

    this.MAKE_SOURCE_ACTIVE(sceneItemId);
  }


  setLockOnAllItems(locked: boolean) {
    this.getItems().forEach(item => item.setLocked(locked));
  }


  setSourceOrder(sceneItemId: string, positionDelta: number, order: string[]) {
    const itemIndex = this.getItemIndex(sceneItemId);
    this.getObsScene().moveItem(itemIndex, itemIndex + positionDelta);
    this.SET_SOURCE_ORDER(order);
  }


  getItemIndex(sceneItemId: string): number {
    return this.sceneState.items.findIndex(sceneItemModel => sceneItemModel.sceneItemId === sceneItemId);
  }

  addSources(items: ISceneItemInfo[]) {
    const arrayItems: (ISceneItemInfo & obs.ISceneItemInfo)[] = [];

    items.forEach(item => {
      const source = this.sourcesService.getSource(item.sourceId);
      if (source) {
        arrayItems.push({
          name: source.name,
          id: item.id,
          sourceId: source.sourceId,
          crop: item.crop,
          scaleX: item.scaleX,
          scaleY: item.scaleY,
          visible: item.visible,
          x: item.x,
          y: item.y,
          locked: item.locked,
          rotation: item.rotation || 0
        });
      }
    });

    const sceneItems = obs.addItems(this.getObsScene(), arrayItems);

    arrayItems.forEach((sceneItem, index) => {
      this.ADD_SOURCE_TO_SCENE(items[index].id, items[index].sourceId, sceneItems[index].id);
      this.getItem(items[index].id).loadItemAttributes(sceneItem);
    });
  }


  canAddSource(sourceId: string): boolean {
    const source = this.sourcesService.getSource(sourceId);
    if (!source) return false;

    // if source is scene then traverse the scenes tree to detect possible infinity scenes loop
    if (source.type !== 'scene') return true;
    if (this.id === source.sourceId) return false;

    const sceneToAdd = this.scenesService.getScene(source.sourceId);
    return !sceneToAdd.hasNestedScene(this.id);
  }


  hasNestedScene(sceneId: string) {
    const childScenes = this.getItems()
      .filter(sceneItem => sceneItem.type === 'scene')
      .map(sceneItem => this.scenesService.getScene(sceneItem.sourceId));

    for (const childScene of childScenes) {
      if (childScene.id === sceneId) return true;
      if (!childScene.hasNestedScene(sceneId)) return true;
    }

    return false;
  }


  @mutation()
  private MAKE_SOURCE_ACTIVE(sceneItemId: string) {
    this.sceneState.activeItemId = sceneItemId;
  }

  @mutation()
  private ADD_SOURCE_TO_SCENE(sceneItemId: string, sourceId: string, obsSceneItemId: number) {
    this.sceneState.items.unshift({
      // This is information that belongs to a scene/source pair

      // The id of the source
      sceneItemId,
      sourceId,
      obsSceneItemId,

      // Position in video space
      x: 0,
      y: 0,

      // Scale between 0 and 1
      scaleX: 1.0,
      scaleY: 1.0,

      visible: true,

      crop: {
        top: 0,
        bottom: 0,
        left: 0,
        right: 0
      },

      rotation: 0,

      locked: false
    });
  }

  @mutation()
  private REMOVE_SOURCE_FROM_SCENE(sceneItemId: string) {

    if (this.sceneState.activeItemId === sceneItemId) {
      this.sceneState.activeItemId = null;
    }

    this.sceneState.items = this.sceneState.items.filter(source => {
      return source.sceneItemId !== sceneItemId;
    });
  }

  @mutation()
  private SET_SOURCE_ORDER(order: string[]) {

    // TODO: This is O(n^2)
    this.sceneState.items = order.map(id => {
      return this.sceneState.items.find(source => {
        return source.sceneItemId === id;
      });
    });
  }

}
