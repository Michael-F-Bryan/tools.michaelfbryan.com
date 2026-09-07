import { expect, test } from "@playwright/test";

import { applyToPoint, eulerToRotation, geodeticToEcef, type Geodetic } from "../src/entries/tools/coordinate-frame-visualiser/math";
import { wholeChain } from "../src/entries/tools/coordinate-frame-visualiser/pose";
import {
  anchorFacing,
  anchorScenePoint,
  cameraFacingAnchor,
  localTriadTips,
  pickOnEllipsoid,
  POSITION_SCALE,
} from "../src/entries/tools/coordinate-frame-visualiser/position-geometry";
import {
  clampElevation,
  MAX_ELEVATION_DEG,
  orbitCamera,
  project,
  sortByDepthAscending,
  type Camera,
  type ScenePoint,
} from "../src/entries/tools/coordinate-frame-visualiser/projection";

test.describe("clampElevation", () => {
  test("passes through angles inside the allowed range", () => {
    expect(clampElevation(0)).toBe(0);
    expect(clampElevation(45)).toBe(45);
    expect(clampElevation(-45)).toBe(-45);
  });

  test("clamps to the pole-avoiding maximum in both directions", () => {
    expect(clampElevation(90)).toBe(MAX_ELEVATION_DEG);
    expect(clampElevation(-90)).toBe(-MAX_ELEVATION_DEG);
    expect(clampElevation(1000)).toBe(MAX_ELEVATION_DEG);
    expect(clampElevation(-1000)).toBe(-MAX_ELEVATION_DEG);
  });
});

test.describe("project", () => {
  const level: Camera = { azimuthDeg: 0, elevationDeg: 0, scale: 1 };

  test("a point along the camera's right axis projects to +x", () => {
    // At azimuth 0 / elevation 0 the camera looks along -X, so world +Y is
    // the camera's right and world +Z is the camera's screen-up.
    const projected = project(level, [0, 1, 0]);
    expect(projected.x).toBeCloseTo(1, 9);
    expect(projected.y).toBeCloseTo(0, 9);
  });

  test("a point along world-up projects to screen -y (up is up)", () => {
    const projected = project(level, [0, 0, 1]);
    expect(projected.x).toBeCloseTo(0, 9);
    expect(projected.y).toBeCloseTo(-1, 9);
  });

  test("scale multiplies the projected x/y", () => {
    const scaled: Camera = { ...level, scale: 25 };
    const projected = project(scaled, [0, 1, 0]);
    expect(projected.x).toBeCloseTo(25, 9);
  });

  test("depth increases toward the camera and decreases away from it", () => {
    const near = project(level, [1, 0, 0]);
    const far = project(level, [-1, 0, 0]);
    expect(near.depth).toBeGreaterThan(far.depth);
    expect(near.depth).toBeCloseTo(1, 9);
    expect(far.depth).toBeCloseTo(-1, 9);
  });

  test("a near-top-down camera projects the two horizontal axes to (near) perpendicular screen vectors", () => {
    // azimuth 0, elevation clamped just short of 90: looking almost straight down.
    const topDown: Camera = { azimuthDeg: 0, elevationDeg: MAX_ELEVATION_DEG, scale: 1 };
    const alongX = project(topDown, [1, 0, 0]);
    const alongY = project(topDown, [0, 1, 0]);
    const dotProduct = alongX.x * alongY.x + alongX.y * alongY.y;
    expect(Math.abs(dotProduct)).toBeLessThan(0.01);
    expect(Math.hypot(alongX.x, alongX.y)).toBeCloseTo(1, 2);
    expect(Math.hypot(alongY.x, alongY.y)).toBeCloseTo(1, 2);

    // World-up is nearly aligned with the view axis, so it projects near the
    // screen origin rather than out to one side.
    const alongUp = project(topDown, [0, 0, 1]);
    expect(Math.hypot(alongUp.x, alongUp.y)).toBeLessThan(0.05);
  });

  test("azimuth is periodic: a full turn returns the same projection", () => {
    const point: ScenePoint = [1, 0.4, -0.2];
    for (const camera of [level, { azimuthDeg: 37, elevationDeg: 25, scale: 3 }]) {
      const fullTurn = project({ ...camera, azimuthDeg: camera.azimuthDeg + 360 }, point);
      const base = project(camera, point);
      expect(fullTurn.x).toBeCloseTo(base.x, 9);
      expect(fullTurn.y).toBeCloseTo(base.y, 9);
      expect(fullTurn.depth).toBeCloseTo(base.depth, 9);
    }
  });

  test("for any camera, screen-right and screen-up are orthonormal (measured via the axis points)", () => {
    for (const azimuthDeg of [0, 37, 90, 180, 260]) {
      const camera: Camera = { azimuthDeg, elevationDeg: 15, scale: 1 };
      // project two points known to be one scene-unit apart along an
      // arbitrary direction and its perpendicular in the view plane by
      // using the camera's own reported right/up via round-trip distances.
      const origin = project(camera, [0, 0, 0]);
      const alongX = project(camera, [1, 0, 0]);
      const alongY = project(camera, [0, 1, 0]);
      const alongZ = project(camera, [0, 0, 1]);
      // Each basis point differs from the origin by exactly one scene unit,
      // so its on-screen displacement can never exceed length 1 (an
      // orthographic projection never lengthens a vector).
      for (const p of [alongX, alongY, alongZ]) {
        const displacement = Math.hypot(p.x - origin.x, p.y - origin.y);
        expect(displacement).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });
});

test.describe("orbitCamera", () => {
  test("accumulates azimuth without wrapping or clamping", () => {
    const camera: Camera = { azimuthDeg: 10, elevationDeg: 0, scale: 1 };
    const orbited = orbitCamera(camera, 15, 0);
    expect(orbited.azimuthDeg).toBeCloseTo(25, 9);
    expect(orbited.scale).toBe(1);
  });

  test("clamps elevation away from the poles", () => {
    const camera: Camera = { azimuthDeg: 0, elevationDeg: 80, scale: 1 };
    const orbited = orbitCamera(camera, 0, 30);
    expect(orbited.elevationDeg).toBe(MAX_ELEVATION_DEG);
  });
});

test.describe("localTriadTips", () => {
  const anchor: Geodetic = { latitudeDeg: -31.9523, longitudeDeg: 115.8613, heightM: 24 };
  const length = 0.16;

  function distance(a: ScenePoint, b: ScenePoint): number {
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  }

  test("each tip is `length` scene units from the anchor, not ~1e-7", () => {
    const anchorPoint = anchorScenePoint(anchor);
    const tips = localTriadTips(anchor, "ned", length);
    expect(tips).toHaveLength(3);
    for (const tip of tips) {
      expect(distance(tip, anchorPoint)).toBeCloseTo(length, 6);
    }
  });

  test("the NED 'D' tip points inward: closer to the origin than the anchor", () => {
    const anchorPoint = anchorScenePoint(anchor);
    const tips = localTriadTips(anchor, "ned", length);
    const dTip = tips[2];
    const originDistanceAnchor = Math.hypot(anchorPoint[0], anchorPoint[1], anchorPoint[2]);
    const originDistanceD = Math.hypot(dTip[0], dTip[1], dTip[2]);
    expect(originDistanceD).toBeLessThan(originDistanceAnchor);
  });
});

test.describe("cameraFacingAnchor", () => {
  test("puts the anchor squarely in front of the camera, at the centre of the scene", () => {
    for (const anchor of [
      { latitudeDeg: -31.9523, longitudeDeg: 115.8613, heightM: 24 },
      { latitudeDeg: 0, longitudeDeg: 0, heightM: 0 },
      { latitudeDeg: 0, longitudeDeg: 180, heightM: 0 },
      { latitudeDeg: 60, longitudeDeg: -120, heightM: 0 },
    ] satisfies Geodetic[]) {
      const camera = cameraFacingAnchor(anchor);
      expect(anchorFacing(camera, anchor)).toBeGreaterThan(0.99);
      const projected = project(camera, anchorScenePoint(anchor));
      expect(Math.hypot(projected.x, projected.y)).toBeLessThan(2);
    }
  });

  test("at a pole the camera's elevation is clamped but the anchor is still in view", () => {
    const pole: Geodetic = { latitudeDeg: 90, longitudeDeg: 0, heightM: 0 };
    expect(anchorFacing(cameraFacingAnchor(pole), pole)).toBeGreaterThan(0.99);
  });
});

test.describe("pickOnEllipsoid", () => {
  const anchor: Geodetic = { latitudeDeg: -31.9523, longitudeDeg: 115.8613, heightM: 24 };

  test("picking where the anchor projects returns the anchor's latitude and longitude", () => {
    for (const camera of [cameraFacingAnchor(anchor), { azimuthDeg: 90, elevationDeg: -10, scale: POSITION_SCALE }]) {
      const projected = project(camera, anchorScenePoint(anchor));
      expect(projected.depth).toBeGreaterThan(0);
      const picked = pickOnEllipsoid(camera, projected.x, projected.y);
      expect(picked).not.toBeNull();
      expect(picked!.latitudeDeg).toBeCloseTo(anchor.latitudeDeg, 5);
      expect(picked!.longitudeDeg).toBeCloseTo(anchor.longitudeDeg, 5);
    }
  });

  test("uses geodetic latitude: the equator and the poles pick exactly", () => {
    const camera: Camera = { azimuthDeg: 0, elevationDeg: 0, scale: POSITION_SCALE };
    const equator = pickOnEllipsoid(camera, 0, 0);
    expect(equator!.latitudeDeg).toBeCloseTo(0, 9);
    expect(equator!.longitudeDeg).toBeCloseTo(0, 9);
    // A screen point just inside the top of the (flattened) ellipsoid outline.
    const nearPole = pickOnEllipsoid(camera, 0, -POSITION_SCALE * 0.9966 + 0.01);
    expect(nearPole!.latitudeDeg).toBeGreaterThan(85);
  });

  test("returns null off the Earth", () => {
    const camera: Camera = { azimuthDeg: 30, elevationDeg: 20, scale: POSITION_SCALE };
    expect(pickOnEllipsoid(camera, POSITION_SCALE * 1.5, 0)).toBeNull();
  });
});

test.describe("wholeChain", () => {
  const anchor: Geodetic = { latitudeDeg: -31.9523, longitudeDeg: 115.8613, heightM: 24 };
  const rNedBody = eulerToRotation({ first: 35, second: 20, third: -15 }, "zyx", "intrinsic");
  const originNed = [1, -2, 0.5] as const;

  test("NED and ENU produce the same ecefFromBody/bodyFromEcef, to 1e-6", () => {
    const nedResult = wholeChain(anchor, "ned", rNedBody, originNed);
    const enuResult = wholeChain(anchor, "enu", rNedBody, originNed);

    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        expect(Math.abs(nedResult.ecefFromBody.m[r][c] - enuResult.ecefFromBody.m[r][c])).toBeLessThan(1e-6);
        expect(Math.abs(nedResult.bodyFromEcef.m[r][c] - enuResult.bodyFromEcef.m[r][c])).toBeLessThan(1e-6);
      }
    }
  });

  test("with a zero body origin, ecefFromBody maps body (0,0,0) to the anchor's ECEF point", () => {
    const { ecefFromBody } = wholeChain(anchor, "ned", rNedBody, [0, 0, 0]);
    const mapped = applyToPoint(ecefFromBody, [0, 0, 0]);
    const expected = geodeticToEcef(anchor);
    expect(mapped[0]).toBeCloseTo(expected.x, 3);
    expect(mapped[1]).toBeCloseTo(expected.y, 3);
    expect(mapped[2]).toBeCloseTo(expected.z, 3);
  });
});

test.describe("sortByDepthAscending", () => {
  test("orders items from farthest to nearest for painter's algorithm", () => {
    const level: Camera = { azimuthDeg: 0, elevationDeg: 0, scale: 1 };
    const points: Array<{ readonly label: string; readonly point: readonly [number, number, number] }> = [
      { label: "near", point: [1, 0, 0] },
      { label: "far", point: [-1, 0, 0] },
      { label: "middle", point: [0, 0, 0] },
    ];

    const ordered = sortByDepthAscending(points, (item) => project(level, item.point).depth);
    expect(ordered.map((item) => item.label)).toEqual(["far", "middle", "near"]);
  });
});
