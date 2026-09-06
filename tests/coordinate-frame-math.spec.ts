import { expect, test } from "@playwright/test";

import {
  approxEqual,
  composeRotations,
  composeTransforms,
  degToRad,
  determinant,
  type EulerInterpretation,
  eulerToRotation,
  applyToDirection,
  applyToPoint,
  geodeticToEcef,
  invertRotation,
  invertTransform,
  type Mat3,
  multiply,
  multiplyMat3Vec3,
  normaliseQuaternion,
  quaternionFromRotation,
  radToDeg,
  rotationAboutAxis,
  rotationAfterStages,
  rotationBlock,
  rotationEcefFromLocal,
  rotationEnuFromNed,
  rotationFromQuaternion,
  rotationToEuler,
  stageAxis,
  type TaitBryanOrder,
  transformEcefFromLocal,
  transformFromRotation,
  translation,
  transpose,
  type Vec3,
  WGS84_B,
  wrapDegrees,
} from "../src/entries/tools/coordinate-frame-visualiser/math";

function expectMat3Close(actual: Mat3, expected: Mat3, epsilon = 5e-4) {
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      expect(
        approxEqual(actual[r][c], expected[r][c], epsilon),
        `m[${r}][${c}]: expected ${expected[r][c]}, got ${actual[r][c]}`,
      ).toBe(true);
    }
  }
}

function expectVec3Close(actual: Vec3, expected: Vec3, epsilon = 5e-4) {
  for (let i = 0; i < 3; i++) {
    expect(
      approxEqual(actual[i], expected[i], epsilon),
      `v[${i}]: expected ${expected[i]}, got ${actual[i]}`,
    ).toBe(true);
  }
}

const IDENTITY: Mat3 = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

test.describe("linalg helpers", () => {
  test("wrapDegrees maps to (-180, 180]", () => {
    expect(wrapDegrees(0)).toBe(0);
    expect(wrapDegrees(180)).toBe(180);
    expect(wrapDegrees(-180)).toBe(180);
    expect(wrapDegrees(181)).toBeCloseTo(-179, 9);
    expect(wrapDegrees(-181)).toBeCloseTo(179, 9);
    expect(wrapDegrees(540)).toBeCloseTo(180, 9);
    expect(wrapDegrees(-540)).toBeCloseTo(180, 9);
  });

  test("degToRad and radToDeg round-trip", () => {
    for (const deg of [0, 30, -45, 90, 180, -179.5]) {
      expect(radToDeg(degToRad(deg))).toBeCloseTo(deg, 9);
    }
  });

  test("transpose, multiply, determinant", () => {
    const m: Mat3 = [
      [1, 2, 3],
      [0, 1, 4],
      [5, 6, 0],
    ];
    expect(transpose(transpose(m))).toEqual(m);
    expect(determinant(m)).toBeCloseTo(1, 9);
    expectMat3Close(multiply(IDENTITY, m), m);
    expectMat3Close(multiply(m, IDENTITY), m);

    // A concrete (non-identity) product, hand-computed: n swaps columns 1 and 2.
    const n: Mat3 = [
      [1, 0, 0],
      [0, 0, 1],
      [0, 1, 0],
    ];
    expectMat3Close(multiply(m, n), [
      [1, 3, 2],
      [0, 4, 1],
      [5, 0, 6],
    ]);
  });
});

test.describe("WGS84 geodetic -> ECEF", () => {
  test("anchor fixture matches independently verified ECEF (nearest metre)", () => {
    const ecef = geodeticToEcef({
      latitudeDeg: -31.9523,
      longitudeDeg: 115.8613,
      heightM: 24,
    });
    expect(Math.round(ecef.x)).toBe(-2_362_811);
    expect(Math.round(ecef.y)).toBe(4_874_393);
    expect(Math.round(ecef.z)).toBe(-3_355_957);
  });

  test("equator and prime meridian maps to (a, 0, 0)", () => {
    const ecef = geodeticToEcef({ latitudeDeg: 0, longitudeDeg: 0, heightM: 0 });
    expect(ecef.x).toBeCloseTo(6_378_137, 3);
    expect(Math.abs(ecef.y)).toBeLessThan(1e-6);
    expect(Math.abs(ecef.z)).toBeLessThan(1e-6);
  });

  test("equator at 90 degrees longitude maps to (0, a, 0)", () => {
    const ecef = geodeticToEcef({ latitudeDeg: 0, longitudeDeg: 90, heightM: 0 });
    expect(Math.abs(ecef.x)).toBeLessThan(1e-6);
    expect(ecef.y).toBeCloseTo(6_378_137, 3);
    expect(Math.abs(ecef.z)).toBeLessThan(1e-6);
  });

  test("north pole maps to (0, 0, b)", () => {
    const ecef = geodeticToEcef({ latitudeDeg: 90, longitudeDeg: 0, heightM: 0 });
    expect(Math.abs(ecef.x)).toBeLessThan(1e-6);
    expect(Math.abs(ecef.y)).toBeLessThan(1e-6);
    expect(ecef.z).toBeCloseTo(WGS84_B, 3);
    expect(WGS84_B).toBeCloseTo(6_356_752.314245, 3);
  });

  test("south pole maps to (0, 0, -b), independent of longitude", () => {
    const ecef = geodeticToEcef({ latitudeDeg: -90, longitudeDeg: 137, heightM: 0 });
    expect(Math.abs(ecef.x)).toBeLessThan(1e-6);
    expect(Math.abs(ecef.y)).toBeLessThan(1e-6);
    expect(ecef.z).toBeCloseTo(-WGS84_B, 3);
  });

  test("height adds along the normal at the equator", () => {
    const ecef = geodeticToEcef({ latitudeDeg: 0, longitudeDeg: 0, heightM: 100 });
    expect(ecef.x).toBeCloseTo(6_378_137 + 100, 3);
  });
});

test.describe("local tangent frames", () => {
  const anchor = { latitudeDeg: -31.9523, longitudeDeg: 115.8613, heightM: 24 };

  test("R[ecef<-ned] matches the fixture to 4 decimal places", () => {
    const rotation = rotationEcefFromLocal(anchor, "ned");
    expectMat3Close(
      rotation.m,
      [
        [-0.2308, -0.8999, 0.3701],
        [0.4762, -0.4362, -0.7635],
        [0.8485, 0.0, 0.5292],
      ],
      5e-5,
    );
  });

  test("R[ecef<-ned] and R[ecef<-enu] are orthonormal with determinant +1", () => {
    for (const convention of ["ned", "enu"] as const) {
      const rotation = rotationEcefFromLocal(anchor, convention);
      expectMat3Close(multiply(rotation.m, transpose(rotation.m)), IDENTITY, 1e-9);
      expect(determinant(rotation.m)).toBeCloseTo(1, 9);
    }
  });

  test("inverting then composing R[ecef<-local] gives identity", () => {
    for (const convention of ["ned", "enu"] as const) {
      const rotation = rotationEcefFromLocal(anchor, convention);
      const roundTrip = composeRotations(invertRotation(rotation), rotation);
      expectMat3Close(roundTrip.m, IDENTITY, 1e-9);
    }
  });

  test("E column of R[ecef<-ned] has zero Z component", () => {
    const rotation = rotationEcefFromLocal(anchor, "ned");
    expect(Math.abs(rotation.m[2][1])).toBeLessThan(1e-9);
  });

  test("T[ecef<-ned] maps the local origin to the anchor's ECEF point", () => {
    const transform = transformEcefFromLocal(anchor, "ned");
    const ecef = geodeticToEcef(anchor);
    expectVec3Close(applyToPoint(transform, [0, 0, 0]), [ecef.x, ecef.y, ecef.z], 1e-6);
  });

  test("T[ned<-ecef] maps the anchor's ECEF point to ~0", () => {
    const transform = invertTransform(transformEcefFromLocal(anchor, "ned"));
    const ecef = geodeticToEcef(anchor);
    expectVec3Close(applyToPoint(transform, [ecef.x, ecef.y, ecef.z]), [0, 0, 0], 1e-6);
  });

  test("R[enu<-ned] swap is its own inverse and matches the fixed matrix", () => {
    expectMat3Close(rotationEnuFromNed.m, [
      [0, 1, 0],
      [1, 0, 0],
      [0, 0, -1],
    ]);
    const roundTrip = composeRotations(rotationEnuFromNed, invertRotation(rotationEnuFromNed));
    expectMat3Close(roundTrip.m, IDENTITY, 1e-9);
    expectMat3Close(invertRotation(rotationEnuFromNed).m, rotationEnuFromNed.m, 1e-9);
  });

  test("ENU basis equals the swap applied to the NED basis", () => {
    const ned = rotationEcefFromLocal(anchor, "ned");
    const enu = rotationEcefFromLocal(anchor, "enu");
    const swapped = composeRotations(ned, invertRotation(rotationEnuFromNed));
    // swapped: R[ecef<-ned] . R[ned<-enu] = R[ecef<-enu]
    expectMat3Close(swapped.m, enu.m, 1e-9);
  });
});

test.describe("Euler angles: composition and decomposition", () => {
  const orders: readonly TaitBryanOrder[] = ["zyx", "zxy", "yxz", "yzx", "xzy", "xyz"];
  const interpretations: readonly EulerInterpretation[] = ["intrinsic", "extrinsic"];

  test("zyx intrinsic fixture: R, quaternion, and probe conversion", () => {
    const angles = { first: 35, second: 20, third: -15 };
    const R = eulerToRotation(angles, "zyx", "intrinsic");

    expectMat3Close(
      R,
      [
        [0.7698, -0.6266, 0.1222],
        [0.539, 0.7405, 0.4015],
        [-0.342, -0.2432, 0.9077],
      ],
      5e-4,
    );

    const q = quaternionFromRotation(R);
    expect(q.w).toBeCloseTo(0.9244, 3);
    expect(q.x).toBeCloseTo(-0.1744, 3);
    expect(q.y).toBeCloseTo(0.1255, 3);
    expect(q.z).toBeCloseTo(0.3152, 3);

    const pNed: Vec3 = [1.5, 0.8, -0.6];
    const pBody = multiplyMat3Vec3(transpose(R), pNed);
    expect(pBody[0]).toBeCloseTo(1.791, 2);
    expect(pBody[1]).toBeCloseTo(-0.202, 2);
    expect(pBody[2]).toBeCloseTo(-0.04, 2);
  });

  test("intrinsic and extrinsic differ for the same angles", () => {
    const angles = { first: 35, second: 20, third: -15 };
    const intrinsic = eulerToRotation(angles, "zyx", "intrinsic");
    const extrinsic = eulerToRotation(angles, "zyx", "extrinsic");

    let anyDifferent = false;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        if (!approxEqual(intrinsic[r][c], extrinsic[r][c], 1e-6)) anyDifferent = true;
      }
    }
    expect(anyDifferent).toBe(true);
  });

  test("intrinsic abc equals extrinsic cba with reversed angles", () => {
    const angles = { first: 35, second: 20, third: -15 };
    const reversed = { first: angles.third, second: angles.second, third: angles.first };

    const intrinsic = eulerToRotation(angles, "zyx", "intrinsic");
    const extrinsic = eulerToRotation(reversed, "xyz", "extrinsic");

    expectMat3Close(intrinsic, extrinsic, 1e-9);
  });

  test("round trip over a non-degenerate angle grid, all 6 orders x 2 interpretations", () => {
    const firstOrThird = [-170, -90, -45, 0, 45, 90, 170];
    const second = [-80, -45, 0, 45, 80];

    for (const order of orders) {
      for (const interpretation of interpretations) {
        for (const first of firstOrThird) {
          for (const s of second) {
            for (const third of firstOrThird) {
              const angles = { first, second: s, third };
              const R = eulerToRotation(angles, order, interpretation);
              const decomposed = rotationToEuler(R, order, interpretation);
              expect(decomposed.gimbalLock).toBe(false);
              const reconstructed = eulerToRotation(decomposed, order, interpretation);
              expectMat3Close(reconstructed, R, 1e-6);
            }
          }
        }
      }
    }
  });

  test("gimbal lock at pitch +90 and -90 (zyx) reproduces the same R", () => {
    for (const pitch of [90, -90]) {
      const angles = { first: 40, second: pitch, third: -20 };
      const R = eulerToRotation(angles, "zyx", "intrinsic");
      const decomposed = rotationToEuler(R, "zyx", "intrinsic");
      expect(decomposed.gimbalLock).toBe(true);
      expect(decomposed.third).toBe(0);
      expect(Math.abs(decomposed.second)).toBeCloseTo(90, 6);
      const reconstructed = eulerToRotation(decomposed, "zyx", "intrinsic");
      expectMat3Close(reconstructed, R, 1e-6);
    }
  });

  test("extrinsic gimbal lock at pitch +90 and -90 (zyx) sets first to 0 and reproduces the same R", () => {
    for (const pitch of [90, -90]) {
      const angles = { first: 40, second: pitch, third: -20 };
      const R = eulerToRotation(angles, "zyx", "extrinsic");
      const decomposed = rotationToEuler(R, "zyx", "extrinsic");
      expect(decomposed.gimbalLock).toBe(true);
      expect(decomposed.first).toBe(0);
      expect(Math.abs(decomposed.second)).toBeCloseTo(90, 6);
      const reconstructed = eulerToRotation(decomposed, "zyx", "extrinsic");
      expectMat3Close(reconstructed, R, 1e-6);
    }
  });

  test("frame-preservation demo: identity R[ned<-body] re-expressed as R[enu<-body]", () => {
    const rNedBody = { to: "ned" as const, from: "body" as const, m: IDENTITY };
    const rEnuBody = composeRotations(rotationEnuFromNed, rNedBody);
    const decomposed = rotationToEuler(rEnuBody.m, "zyx", "intrinsic");

    expect(wrapDegrees(decomposed.first)).toBeCloseTo(90, 6);
    expect(decomposed.second).toBeCloseTo(0, 6);
    expect(wrapDegrees(decomposed.third)).toBeCloseTo(180, 6);
  });
});

test.describe("staged / scrubbed Euler sequence", () => {
  const angles = { first: 35, second: 20, third: -15 };

  test("progress 0 is identity and progress 3 equals the full pose", () => {
    expectMat3Close(rotationAfterStages(angles, "zyx", "intrinsic", 0), IDENTITY, 1e-9);
    expectMat3Close(
      rotationAfterStages(angles, "zyx", "intrinsic", 3),
      eulerToRotation(angles, "zyx", "intrinsic"),
      1e-9,
    );
    expectMat3Close(
      rotationAfterStages(angles, "zyx", "extrinsic", 3),
      eulerToRotation(angles, "zyx", "extrinsic"),
      1e-9,
    );
  });

  test("intrinsic stage 1 axis equals the fixed first axis", () => {
    const axis = stageAxis(angles, "zyx", "intrinsic", 1);
    expectVec3Close(axis, [0, 0, 1]);
  });

  test("intrinsic stage 2 axis for zyx (yaw 35) is Rz(35).e_y", () => {
    const axis = stageAxis(angles, "zyx", "intrinsic", 2);
    const rad = degToRad(35);
    expectVec3Close(axis, [-Math.sin(rad), Math.cos(rad), 0]);
  });

  test("extrinsic stage axes never change with angles", () => {
    const otherAngles = { first: -170, second: 12, third: 88 };
    for (const stageIndex of [1, 2, 3] as const) {
      const a = stageAxis(angles, "zyx", "extrinsic", stageIndex);
      const b = stageAxis(otherAngles, "zyx", "extrinsic", stageIndex);
      expectVec3Close(a, b, 1e-12);
    }
  });

  test("R(k) = rotationAboutAxis(stageAxis(k), angle_k) . R(k-1), both interpretations", () => {
    for (const interpretation of ["intrinsic", "extrinsic"] as const) {
      const perStageAngle = [angles.first, angles.second, angles.third];
      for (const k of [1, 2, 3] as const) {
        const rPrev = rotationAfterStages(angles, "zyx", interpretation, k - 1);
        const rCurrent = rotationAfterStages(angles, "zyx", interpretation, k);
        const axis = stageAxis(angles, "zyx", interpretation, k);
        const stepped = multiply(rotationAboutAxis(axis, perStageAngle[k - 1]), rPrev);
        expectMat3Close(stepped, rCurrent, 1e-6);
      }
    }
  });
});

test.describe("rotationAboutAxis", () => {
  test("a zero-length axis throws", () => {
    expect(() => rotationAboutAxis([0, 0, 0], 30)).toThrow();
  });

  test("a non-unit axis yields the same matrix as its normalised direction", () => {
    expectMat3Close(rotationAboutAxis([0, 0, 2], 30), rotationAboutAxis([0, 0, 1], 30), 1e-9);
  });
});

test.describe("quaternions", () => {
  test("round trip with matrices for many poses", () => {
    const samples = [
      { first: 0, second: 0, third: 0 },
      { first: 35, second: 20, third: -15 },
      { first: -170, second: -80, third: 90 },
      { first: 12, second: 45, third: -170 },
      { first: 170, second: -45, third: 5 },
    ];

    for (const angles of samples) {
      const R = eulerToRotation(angles, "zyx", "intrinsic");
      const q = quaternionFromRotation(R);
      const reconstructed = rotationFromQuaternion(q);
      expectMat3Close(reconstructed, R, 1e-6);
      expect(q.w).toBeGreaterThanOrEqual(-1e-9);
    }
  });

  test("q and -q give the same rotation matrix", () => {
    const q = { w: 0.9244, x: -0.1744, y: 0.1255, z: 0.3152 };
    const negated = { w: -q.w, x: -q.x, y: -q.y, z: -q.z };
    expectMat3Close(rotationFromQuaternion(q), rotationFromQuaternion(negated), 1e-9);
  });

  test("non-unit input is normalised and reports the original norm", () => {
    const result = normaliseQuaternion({ w: 2, x: 0, y: 0, z: 0 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.originalNorm).toBeCloseTo(2, 9);
      expect(result.quaternion).toEqual({ w: 1, x: 0, y: 0, z: 0 });
    }
  });

  test("zero quaternion is rejected without throwing", () => {
    const result = normaliseQuaternion({ w: 0, x: 0, y: 0, z: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("zero");
    }
  });

  test("non-finite quaternion is rejected without throwing", () => {
    const result = normaliseQuaternion({ w: NaN, x: 0, y: 0, z: 0 });
    expect(result.ok).toBe(false);
  });

  test("rotationFromQuaternion is scale-invariant for a non-unit quaternion", () => {
    const unit = { w: 0.9244, x: -0.1744, y: 0.1255, z: 0.3152 };
    const scaled = { w: unit.w * 3.7, x: unit.x * 3.7, y: unit.y * 3.7, z: unit.z * 3.7 };

    const fromUnit = rotationFromQuaternion(unit);
    const fromScaled = rotationFromQuaternion(scaled);
    expectMat3Close(fromScaled, fromUnit, 1e-9);

    expectMat3Close(multiply(fromScaled, transpose(fromScaled)), IDENTITY, 1e-9);
    expect(determinant(fromScaled)).toBeCloseTo(1, 9);
  });

  test("rotationFromQuaternion throws for a zero quaternion", () => {
    expect(() => rotationFromQuaternion({ w: 0, x: 0, y: 0, z: 0 })).toThrow();
  });

  test("rotationFromQuaternion throws for a non-finite quaternion", () => {
    expect(() => rotationFromQuaternion({ w: NaN, x: 0, y: 0, z: 0 })).toThrow();
  });
});

test.describe("homogeneous transforms", () => {
  test("T . T^-1 = I and a point round-trips", () => {
    const R = eulerToRotation({ first: 35, second: 20, third: -15 }, "zyx", "intrinsic");
    const T = transformFromRotation({ to: "ned" as const, from: "body" as const, m: R }, [10, -4, 2]);
    const Tinv = invertTransform(T);
    const roundTrip = composeTransforms(T, Tinv);

    expectMat3Close(rotationBlock(roundTrip).m, IDENTITY, 1e-9);
    expectVec3Close(translation(roundTrip), [0, 0, 0], 1e-9);

    const point: Vec3 = [1, 2, 3];
    expectVec3Close(applyToPoint(Tinv, applyToPoint(T, point)), point, 1e-9);
  });

  test("a direction ignores translation", () => {
    const R = eulerToRotation({ first: 10, second: 5, third: 0 }, "zyx", "intrinsic");
    const t: Vec3 = [100, 200, 300];
    const T = transformFromRotation({ to: "ned" as const, from: "body" as const, m: R }, t);
    const direction: Vec3 = [1, 0, 0];

    const rotatedOnly = applyToDirection(T, direction);
    expectVec3Close(rotatedOnly, [R[0][0], R[1][0], R[2][0]], 1e-9);

    const pointResult = applyToPoint(T, direction);
    expectVec3Close(
      pointResult,
      [rotatedOnly[0] + t[0], rotatedOnly[1] + t[1], rotatedOnly[2] + t[2]],
      1e-9,
    );
  });

  test("rotationBlock and translation prove T contains R and t", () => {
    const R = eulerToRotation({ first: 10, second: 5, third: 0 }, "zyx", "intrinsic");
    const t: Vec3 = [1, 2, 3];
    const T = transformFromRotation({ to: "ned" as const, from: "body" as const, m: R }, t);
    expectMat3Close(rotationBlock(T).m, R, 1e-12);
    expectVec3Close(translation(T), t, 1e-12);
  });

  test("whole chain T[ecef<-body] = T[ecef<-ned] . T[ned<-body]", () => {
    const anchor = { latitudeDeg: -31.9523, longitudeDeg: 115.8613, heightM: 24 };
    const ecefFromNed = transformEcefFromLocal(anchor, "ned");
    const R = eulerToRotation({ first: 35, second: 20, third: -15 }, "zyx", "intrinsic");
    const nedFromBody = transformFromRotation({ to: "ned" as const, from: "body" as const, m: R }, [0, 0, 0]);

    const ecefFromBody = composeTransforms(ecefFromNed, nedFromBody);
    const ecef = geodeticToEcef(anchor);
    expectVec3Close(applyToPoint(ecefFromBody, [0, 0, 0]), [ecef.x, ecef.y, ecef.z], 1e-6);
  });

  test("the composed inverse equals the reversed product of inverses", () => {
    const anchor = { latitudeDeg: -31.9523, longitudeDeg: 115.8613, heightM: 24 };
    const ecefFromNed = transformEcefFromLocal(anchor, "ned");
    const R = eulerToRotation({ first: 35, second: 20, third: -15 }, "zyx", "intrinsic");
    const nedFromBody = transformFromRotation({ to: "ned" as const, from: "body" as const, m: R }, [1, 2, 3]);

    const ecefFromBody = composeTransforms(ecefFromNed, nedFromBody);
    const direct = invertTransform(ecefFromBody);
    const reversed = composeTransforms(invertTransform(nedFromBody), invertTransform(ecefFromNed));

    expectMat3Close(rotationBlock(direct).m, rotationBlock(reversed).m, 1e-9);
    expectVec3Close(translation(direct), translation(reversed), 1e-6);
  });
});
