import { fullRingPath, wedgePath } from "./geometry";

const CX = 64;
const CY = 48;

export default function TimezoneClockPreview() {
  return (
    <svg viewBox="0 0 128 96" className="h-full w-full" fill="none" focusable="false">
      <path d={fullRingPath(CX, CY, 34, 40)} className="fill-panel" fillRule="evenodd" />
      <path d={wedgePath(CX, CY, 34, 40, 40, 150)} fill="#0072B2" />
      <path d={fullRingPath(CX, CY, 25, 31)} className="fill-panel" fillRule="evenodd" />
      <path d={wedgePath(CX, CY, 25, 31, 160, 260)} fill="#009E73" />
      <path d={fullRingPath(CX, CY, 16, 22)} className="fill-panel" fillRule="evenodd" />
      <path d={wedgePath(CX, CY, 16, 22, 300, 410)} fill="#D55E00" />
      <circle cx={CX} cy={CY} r={10} className="fill-surface stroke-rule" />
      <line x1={CX} y1={CY} x2={CX + 38} y2={CY - 20} className="stroke-accent" strokeWidth={2} />
      <circle cx={CX + 38} cy={CY - 20} r={3} className="fill-accent" />
    </svg>
  );
}
