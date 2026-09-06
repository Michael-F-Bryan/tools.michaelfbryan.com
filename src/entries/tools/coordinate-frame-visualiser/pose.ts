/**
 * Pure pose state and transitions for the orientation mode.
 *
 * Canonical source of truth is `R[ned<-body]` plus the body's origin in NED
 * metres. The three angle numbers shown in the "Angles" group are state
 * too, kept verbatim across transitions that should not change them (order
 * and interpretation) and recomputed only when the physical pose is
 * re-expressed in a different way (convention switch, quaternion commit).
 */
import {
  type EulerAngles,
  type EulerInterpretation,
  eulerToRotation,
  type LocalConvention,
  type Mat3,
  multiply,
  multiplyMat3Vec3,
  type Quaternion,
  rotationEnuFromNed,
  rotationFromQuaternion,
  rotationToEuler,
  type TaitBryanOrder,
  type Vec3,
} from "./math";

export type PoseState = Readonly<{
  convention: LocalConvention;
  order: TaitBryanOrder;
  interpretation: EulerInterpretation;
  /** The three angles as currently displayed, for (order, interpretation, convention). */
  angles: EulerAngles;
  /** Canonical rotation `R[ned<-body]`. */
  rNedBody: Mat3;
  /** Canonical body origin, in NED metres. */
  originNed: Vec3;
  /** Canonical probe point, in NED metres. */
  probeNed: Vec3;
}>;

export const OPENING_ANGLES: EulerAngles = { first: 35, second: 20, third: -15 };
export const OPENING_PROBE_NED: Vec3 = [1.5, 0.8, -0.6];

export function initialPoseState(): PoseState {
  return {
    convention: "ned",
    order: "zyx",
    interpretation: "intrinsic",
    angles: OPENING_ANGLES,
    rNedBody: eulerToRotation(OPENING_ANGLES, "zyx", "intrinsic"),
    originNed: [0, 0, 0],
    probeNed: OPENING_PROBE_NED,
  };
}

/**
 * The fixed NED<->ENU basis swap is its own inverse, so the same function
 * re-expresses a vector (or rotation) from NED into the active convention
 * and back again.
 */
export function reexpressVec3(convention: LocalConvention, nedOrActive: Vec3): Vec3 {
  return convention === "ned" ? nedOrActive : multiplyMat3Vec3(rotationEnuFromNed.m, nedOrActive);
}

export function reexpressRotation(convention: LocalConvention, nedOrActiveRotation: Mat3): Mat3 {
  return convention === "ned" ? nedOrActiveRotation : multiply(rotationEnuFromNed.m, nedOrActiveRotation);
}

/** `R[local<-body]` for the state's active convention. */
export function activeRotation(state: PoseState): Mat3 {
  return reexpressRotation(state.convention, state.rNedBody);
}

/** The body origin, in the active convention's coordinates. */
export function activeOrigin(state: PoseState): Vec3 {
  return reexpressVec3(state.convention, state.originNed);
}

/** The probe point, in the active convention's coordinates. */
export function activeProbe(state: PoseState): Vec3 {
  return reexpressVec3(state.convention, state.probeNed);
}

function withRNedBodyFromActive(state: PoseState, rActiveBody: Mat3): Mat3 {
  // reexpressRotation is its own inverse, so applying it again converts back to NED.
  return reexpressRotation(state.convention, rActiveBody);
}

/** Applies a single edited angle (the user is typing or dragging a slider). */
export function withAngleEdit(
  state: PoseState,
  field: keyof EulerAngles,
  value: number,
): PoseState {
  const angles: EulerAngles = { ...state.angles, [field]: value };
  const rActive = eulerToRotation(angles, state.order, state.interpretation);
  return { ...state, angles, rNedBody: withRNedBodyFromActive(state, rActive) };
}

/** Changes the rotation order, keeping the three angle numbers and moving the block. */
export function withOrder(state: PoseState, order: TaitBryanOrder): PoseState {
  const rActive = eulerToRotation(state.angles, order, state.interpretation);
  return { ...state, order, rNedBody: withRNedBodyFromActive(state, rActive) };
}

/** Changes intrinsic/extrinsic, keeping the three angle numbers and moving the block. */
export function withInterpretation(state: PoseState, interpretation: EulerInterpretation): PoseState {
  const rActive = eulerToRotation(state.angles, state.order, interpretation);
  return { ...state, interpretation, rNedBody: withRNedBodyFromActive(state, rActive) };
}

/**
 * Changes the local convention, keeping the physical pose (R and origin
 * unchanged in NED) and recomputing the displayed angle numbers. At gimbal
 * lock the decomposition is not unique, so the previously typed angles are
 * kept rather than replaced.
 */
export function withConvention(state: PoseState, convention: LocalConvention): PoseState {
  const rActive = reexpressRotation(convention, state.rNedBody);
  const decomposed = rotationToEuler(rActive, state.order, state.interpretation);
  const angles = decomposed.gimbalLock ? state.angles : decomposed;
  return { ...state, convention, angles };
}

/** Commits a (already-normalised) quaternion as the new active-convention rotation. */
export function withQuaternion(state: PoseState, q: Quaternion): PoseState {
  const rActive = rotationFromQuaternion(q);
  const decomposed = rotationToEuler(rActive, state.order, state.interpretation);
  const angles = decomposed.gimbalLock ? state.angles : decomposed;
  return { ...state, angles, rNedBody: withRNedBodyFromActive(state, rActive) };
}

export function withOriginEdit(state: PoseState, field: 0 | 1 | 2, value: number): PoseState {
  const active = activeOrigin(state);
  const nextActive: Vec3 =
    field === 0 ? [value, active[1], active[2]] : field === 1 ? [active[0], value, active[2]] : [active[0], active[1], value];
  return { ...state, originNed: reexpressVec3(state.convention, nextActive) };
}

export function withProbeEdit(state: PoseState, field: 0 | 1 | 2, value: number): PoseState {
  const active = activeProbe(state);
  const nextActive: Vec3 =
    field === 0 ? [value, active[1], active[2]] : field === 1 ? [active[0], value, active[2]] : [active[0], active[1], value];
  return { ...state, probeNed: reexpressVec3(state.convention, nextActive) };
}
