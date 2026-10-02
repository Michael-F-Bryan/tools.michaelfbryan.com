export type { Frame, Mat3, Mat4, Rotation, Transform, Vec3, Vec4 } from "./types";

export {
  addVec3,
  approxEqual,
  degToRad,
  determinant,
  dotVec3,
  identityMat3,
  multiply,
  multiplyMat3Vec3,
  normVec3,
  normaliseVec3,
  radToDeg,
  scaleVec3,
  subVec3,
  transpose,
  wrapDegrees,
} from "./linalg";

export { WGS84_A, WGS84_B, WGS84_E2, WGS84_INV_F, geodeticToEcef } from "./wgs84";
export type { Ecef, Geodetic } from "./wgs84";

export {
  rotationEcefFromLocal,
  rotationEnuFromNed,
  transformEcefFromLocal,
} from "./localFrame";
export type { LocalConvention } from "./localFrame";

export { composeRotations, invertRotation } from "./rotation";

export {
  applyToDirection,
  applyToPoint,
  composeTransforms,
  invertTransform,
  rotationBlock,
  transformFromRotation,
  translation,
} from "./transform";

export {
  eulerToRotation,
  rotationAboutAxis,
  rotationAfterStages,
  rotationToEuler,
  stageAxis,
} from "./euler";
export type { EulerAngles, EulerDecomposition, EulerInterpretation, TaitBryanOrder } from "./euler";

export {
  normaliseQuaternion,
  quaternionFromRotation,
  rotationFromQuaternion,
} from "./quaternion";
export type { Quaternion, QuaternionNormalisationResult } from "./quaternion";
