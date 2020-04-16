/*
 * Copyright (C) 2017-2019 HERE Europe B.V.
 * Licensed under Apache 2.0, see full license in LICENSE
 * SPDX-License-Identifier: Apache-2.0
 */

// tslint:disable:no-unused-expression
//    expect-type assertions are unused expressions and are perfectly valid

// tslint:disable:no-empty
//    lots of stubs are needed which are just placeholders and are empty

// tslint:disable:only-arrow-functions
//    Mocha discourages using arrow functions, see https://mochajs.org/#arrow-functions

import {
    DecodedTile,
    ExtendedTileInfo,
    Geometry,
    GeometryType
} from "@here/harp-datasource-protocol";
import { GeoJsonDataProvider } from "@here/harp-geojson-datasource";
import { GeoCoordinates, TileKey } from "@here/harp-geoutils";
import {
    MapView,
    MapViewEventNames,
    TextElementsRenderer,
    TileLoaderState
} from "@here/harp-mapview";
import { GeoJsonTiler } from "@here/harp-mapview-decoder/lib/GeoJsonTiler";
import { getTestResourceUrl, waitForEvent, willEventually } from "@here/harp-test-utils/";
import * as TestUtils from "@here/harp-test-utils/lib/WebGLStub";
import { FontCatalog, TextCanvas } from "@here/harp-text-canvas";
import { getAppBaseUrl } from "@here/harp-utils";
import { assert } from "chai";
import * as sinon from "sinon";
import * as THREE from "three";
import { OmvTileDecoder } from "../index-worker";
import { OmvDataSource } from "../lib/OmvDataSource";
import { OmvTile } from "../lib/OmvTile";
import { GEOJSON_DATA, THEME } from "./resources/geoJsonData";

declare const global: any;

// sets the given point in the middle of the screen
async function displayLocation(mapView: MapView, location: GeoCoordinates) {
    mapView.lookAt({ target: location, zoomLevel: 2 });
    await waitForEvent(mapView, MapViewEventNames.FrameComplete);
}

describe("MapView Picking", async function() {
    const inNodeContext = typeof window === "undefined";
    const tileKey = new TileKey(0, 0, 0);

    let sandbox: sinon.SinonSandbox;
    let clearColorStub: sinon.SinonStub;
    let addEventListenerSpy: sinon.SinonStub;
    let removeEventListenerSpy: sinon.SinonStub;
    let canvas: HTMLCanvasElement;
    let mapView: MapView;
    let geoJsonDataSource: OmvDataSource;

    async function getDecodedTile() {
        let tile = geoJsonDataSource.getTile(tileKey);

        assert(tile !== undefined);
        tile = tile as OmvTile;

        assert.isDefined(tile.tileLoader);

        const state = await tile.tileLoader!.loadAndDecode();
        assert.equal(state, TileLoaderState.Ready);

        const decodeTile = tile.decodedTile as DecodedTile;
        assert.isDefined(decodeTile);
        return decodeTile;
    }

    before(async function() {});

    beforeEach(async function() {
        if (inNodeContext) {
            const g = global as any;
            g.window = {
                window: { devicePixelRatio: 1.0 }, // ???
                location: {
                    href: getAppBaseUrl()
                }
            };
            g.navigator = {};
            g.requestAnimationFrame = (cb: (delta: number) => void) => {
                return setTimeout(() => cb(15), 15);
            };
            g.cancelAnimationFrame = (id: any) => {
                return clearTimeout(id);
            };
            g.performance = { now: Date.now };
        }

        sandbox = sinon.createSandbox();
        clearColorStub = sandbox.stub();
        sandbox
            .stub(THREE, "WebGLRenderer")
            .returns(TestUtils.getWebGLRendererStub(sandbox, clearColorStub));

        // fake texture loading
        sandbox.stub(FontCatalog as any, "loadTexture").callsFake((url: URL) => {
            return {
                image: {
                    width: 512,
                    height: 512
                }
            };
        });

        addEventListenerSpy = sinon.stub();
        removeEventListenerSpy = sinon.stub();

        canvas = ({
            clientWidth: 800,
            clientHeight: 600,
            addEventListener: addEventListenerSpy,
            removeEventListener: removeEventListenerSpy
        } as unknown) as HTMLCanvasElement;

        mapView = new MapView({
            canvas,
            decoderCount: 0,
            theme: THEME,
            enableRoadPicking: true,
            disableFading: true,
            fontCatalog: getTestResourceUrl(
                "@here/harp-fontcatalog",
                "resources/Default_FontCatalog.json"
            )
        });

        await waitForEvent(mapView, MapViewEventNames.ThemeLoaded);
        sinon
            .stub(mapView.textElementsRenderer, "renderText")
            .callsFake((_camera: THREE.OrthographicCamera) => {});

        const geoJsonDataProvider = new GeoJsonDataProvider("italy_test", GEOJSON_DATA, {
            tiler: new GeoJsonTiler()
        });

        geoJsonDataSource = new OmvDataSource({
            decoder: new OmvTileDecoder(),
            dataProvider: geoJsonDataProvider,
            name: "geojson",
            styleSetName: "geojson",
            gatherFeatureAttributes: true,
            createTileInfo: true
        });

        await mapView.addDataSource(geoJsonDataSource);
    });

    afterEach(function() {
        sandbox.restore();
        mapView.dispose();
        if (inNodeContext) {
            delete global.window;
            delete global.requestAnimationFrame;
            delete global.cancelAnimationFrame;
            delete global.navigator;
        }
    });

    after(function() {});

    it("Decoded tile is created", async () => {
        const decodeTile = await getDecodedTile();

        assert.isDefined(decodeTile.textGeometries);
        assert.isDefined(decodeTile.geometries);
        assert.equal(decodeTile.geometries.length, 2);

        const tileInfo = decodeTile.tileInfo as ExtendedTileInfo;
        assert.isDefined(tileInfo);
    });

    it("Decoded tile contains text pick info", async () => {
        const decodeTile = await getDecodedTile();

        assert.equal(decodeTile.textGeometries!.length, 1);
        const textElem = decodeTile.textGeometries![0];

        assert.isDefined(textElem.objInfos);
        assert.deepInclude(textElem.objInfos![0], GEOJSON_DATA.features[2].properties);
    });

    it("Decoded tile contains line pick data pointer", async () => {
        const decodeTile = await getDecodedTile();
        const lineGeometry = decodeTile.geometries!.find(
            geometry => geometry.type === GeometryType.SolidLine
        );

        assert.isDefined(lineGeometry);
        assert.isDefined(lineGeometry!.groups);
        assert.equal(lineGeometry!.groups.length, 1);
    });

    it("decodedTile contains polygon objInfos", async () => {
        const decodeTile = await getDecodedTile();

        const polygonGeometry = decodeTile.geometries!.find(
            geometry => geometry.type === GeometryType.Polygon
        ) as Geometry;

        assert.isDefined(polygonGeometry, "polygon geometry missing");
        assert.isDefined(polygonGeometry.groups, "polygon geometry groups missing");
        assert.equal(polygonGeometry.groups.length, 1);
        assert.isDefined(polygonGeometry.objInfos, "objInfos missing");
        assert.equal(polygonGeometry.objInfos!.length, 1);

        const objInfo = polygonGeometry.objInfos![0] as any;
        assert.include(objInfo, GEOJSON_DATA.features[0].properties);
    });

    // emulate a real pick in browser
    it("Pick polygon", async () => {
        const POLYGON_DATA = GEOJSON_DATA.features[0];
        const POINT = GEOJSON_DATA.features[3];
        const pointCoordinates = ((POINT.geometry as any).coordinates as any) as number[];

        const point = new GeoCoordinates(pointCoordinates[1], pointCoordinates[0]);
        await displayLocation(mapView, point);

        const screenPointLocation = mapView.getScreenPosition(point) as THREE.Vector2;
        assert.isDefined(screenPointLocation);

        mapView.scene.updateWorldMatrix(false, true);

        const usableIntersections = mapView
            .intersectMapObjects(screenPointLocation.x, screenPointLocation.y)
            .filter(item => item.userData !== undefined);

        assert.equal(usableIntersections.length, 1);
        assert.include(usableIntersections[0].userData, POLYGON_DATA.properties);
    });

    // emulate a real pick in browser
    it("Pick line", async () => {
        const LINE_DATA = GEOJSON_DATA.features[1];
        const coordinates = ((LINE_DATA.geometry as any).coordinates as any) as number[][];
        const pointLocation = new GeoCoordinates(coordinates[1][1], coordinates[1][0]);

        await displayLocation(mapView, pointLocation);

        const screenPointLocation = mapView.getScreenPosition(pointLocation) as THREE.Vector2;
        assert.isDefined(screenPointLocation);

        const usableIntersections = mapView
            .intersectMapObjects(screenPointLocation.x, screenPointLocation.y)
            .filter(item => item.userData !== undefined);

        assert.equal(usableIntersections.length, 1);
        assert.include(usableIntersections[0].userData, LINE_DATA.properties);
    });

    // emulate a real pick in browser
    // INFO: Disabled until text renderer refactor (Travis ci build fails).
    it("Pick point", async () => {
        const POINT_DATA = GEOJSON_DATA.features[2];
        const coordinates = ((POINT_DATA.geometry as any).coordinates as any) as number[];
        const pointLocation = new GeoCoordinates(coordinates[1], coordinates[0]);

        await displayLocation(mapView, pointLocation);

        const screenPointLocation = mapView.getScreenPosition(pointLocation) as THREE.Vector2;
        assert.isDefined(screenPointLocation);

        const usableIntersections = mapView
            .intersectMapObjects(screenPointLocation.x, screenPointLocation.y)
            .filter(item => item.userData !== undefined);

        assert.equal(usableIntersections.length, 1);
        assert.include(usableIntersections[0].userData, POINT_DATA.properties);
    });
});
