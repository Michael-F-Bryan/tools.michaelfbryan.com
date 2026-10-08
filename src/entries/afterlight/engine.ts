import {addStar, connections, decode, encode, random, MAX_STARS, type Star} from './model';
import {Instrument} from './audio';

export function mountInstrument(root: HTMLDivElement) {
const controller = new AbortController();
const options = {signal: controller.signal};
let disposed = false, animation = 0;
const downloads = new Map<string, ReturnType<typeof setTimeout>>();
type Elements = {
  sky: HTMLCanvasElement; tempo: HTMLInputElement; 'tempo-value': HTMLOutputElement;
  sound: HTMLButtonElement; pause: HTMLButtonElement; add: HTMLButtonElement;
  undo: HTMLButtonElement; clear: HTMLButtonElement; share: HTMLButtonElement; save: HTMLButtonElement;
  count: HTMLSpanElement; phase: HTMLSpanElement; invitation: HTMLDivElement; status: HTMLParagraphElement;
};
const $ = <K extends keyof Elements>(id: K) => root.querySelector<Elements[K]>(`#afterlight-${id}`)!;
const canvas = $('sky'), ctx = canvas.getContext('2d')!;
const background = document.createElement('canvas');
const instrument = new Instrument();
let stars: Star[] = [], edges: [number, number][] = [], width = 0, height = 0;
let bounds = {left: 0, top: 0, width: 1, height: 1};
const motion = matchMedia('(prefers-reduced-motion: reduce)');
let paused = motion.matches;
motion.addEventListener('change', () => {
  paused = motion.matches;
  if (paused) instrument.silence();
  update(); render();
}, options);
let drawing: number | null = null, gesture = 0, clock = 0, previous = 0, beat = 0, cursor = 0;
let pulses: {star: Star; time: number}[] = [], statusTimer: ReturnType<typeof setTimeout> | undefined;

function status(message: string) {
  if (disposed) return;
  $('status').textContent = message;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => $('status').textContent = '', 6000);
}

function loadShape() {
  stars = [];
  try {
    if (location.hash) stars = decode(decodeURIComponent(location.hash.slice(1)));
  } catch (error) {status(error instanceof Error ? error.message : 'This constellation link is damaged.');}
}
loadShape();
window.addEventListener('hashchange', () => {
  loadShape(); pulses = []; cursor = 0; beat = 0;
  instrument.silence(); update(); render();
}, options);

function update() {
  edges = connections(stars);
  $('count').textContent = `${stars.length} ${stars.length === 1 ? 'star' : 'stars'}`;
  $('invitation').dataset.hidden = String(stars.length > 0);
  $('clear').disabled = $('undo').disabled = stars.length === 0;
  $('add').disabled = stars.length >= MAX_STARS;
  $('pause').textContent = paused ? 'Resume' : 'Pause';
  $('pause').setAttribute('aria-pressed', String(paused));
  $('phase').textContent = paused ? 'a moment held still' : stars.length ? 'a shape becoming a song' : 'the sky is listening';
  cursor %= Math.max(stars.length, 1);
}

function resize() {
  // App Router may hide a departing tree before its effects are disposed.
  if (disposed || !root.clientWidth || !root.clientHeight) return;
  width = root.clientWidth; height = root.clientHeight;
  const ratio = Math.min(devicePixelRatio || 1, 2);
  canvas.width = width * ratio; canvas.height = height * ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  background.width = width * ratio; background.height = height * ratio;
  const bg = background.getContext('2d')!;
  bg.scale(ratio, ratio);
  bg.fillStyle = '#101b22'; bg.fillRect(0, 0, width, height);
  const clouds: [number, number, number, string][] = [[.65,.4,.65,'#274541'],[.35,.6,.45,'#303b3a'],[.9,.15,.4,'#26363c']];
  for (const [x,y,size,color] of clouds) {
    const gradient = bg.createRadialGradient(x*width,y*height,0,x*width,y*height,width*size);
    gradient.addColorStop(0,color); gradient.addColorStop(1,'#101b2200');
    bg.fillStyle = gradient; bg.fillRect(0,0,width,height);
  }
  const rng = random(74138);
  for (let i = 0; i < 700; i++) {
    const x=rng()*width, y=rng()*height, r=rng()*.8+.15;
    bg.fillStyle = `rgba(205,219,206,${rng()*.4+.07})`;
    bg.beginPath(); bg.arc(x,y,r,0,Math.PI*2); bg.fill();
  }
  const top = 35, bottom = $('status').parentElement!.getBoundingClientRect().top - root.getBoundingClientRect().top - 55;
  bounds = {left:width*.08, top, width:width*.84, height:Math.max(100,bottom-top)};
  render();
}

const point = (star: Star): [number, number] => [bounds.left + star.x*bounds.width, bounds.top + star.y*bounds.height];
function render() {
  ctx.clearRect(0,0,width,height);
  ctx.drawImage(background,0,0,width,height);
  ctx.lineWidth = 0.7;
  for (const [a,b] of edges) {
    const from=point(stars[a]), to=point(stars[b]);
    ctx.strokeStyle = 'rgba(203,200,161,.32)';
    ctx.beginPath(); ctx.moveTo(...from); ctx.lineTo(...to); ctx.stroke();
  }
  for (let i=0;i<stars.length;i++) {
    const [x,y]=point(stars[i]);
    const shimmer = paused ? .75 : .75 + Math.sin(clock*.7+i*2.1)*.15;
    const glow = ctx.createRadialGradient(x,y,0,x,y,17);
    glow.addColorStop(0,`rgba(236,198,134,${shimmer*.35})`);
    glow.addColorStop(1,'rgba(236,198,134,0)');
    ctx.fillStyle=glow; ctx.fillRect(x-17,y-17,34,34);
    ctx.fillStyle='#f7e6bb'; ctx.beginPath(); ctx.arc(x,y,2.1,0,Math.PI*2); ctx.fill();
    if (i%5===0) {
      ctx.strokeStyle='rgba(240,220,177,.6)';
      ctx.beginPath(); ctx.moveTo(x-5,y);ctx.lineTo(x+5,y);ctx.moveTo(x,y-5);ctx.lineTo(x,y+5);ctx.stroke();
    }
  }
  for (const pulse of pulses) {
    const [x,y]=point(pulse.star), age=clock-pulse.time;
    ctx.strokeStyle=`rgba(237,202,147,${Math.max(0,.5*(1-age/2))})`;
    ctx.lineWidth=.8;ctx.beginPath();ctx.arc(x,y,4+age*22,0,Math.PI*2);ctx.stroke();
  }
}

function light(star: Star, sound = true) {
  if (!paused) pulses.push({star:{...star},time:clock});
  if (sound && !paused) instrument.play(star);
}

function frame(timestamp: number) {
  const delta = previous ? Math.min((timestamp-previous)/1000,.05) : 0;
  previous=timestamp;
  if (!paused && !document.hidden) {
    clock+=delta; beat-=delta;
    pulses=pulses.filter(p => clock-p.time<2);
    if (stars.length && beat<=0) {
      light(stars[cursor]);cursor=(cursor+1)%stars.length;
      beat=60/Number($('tempo').value);
    }
    render();
  }
  animation = requestAnimationFrame(frame);
}

function place(x: number,y: number) {
  const added=addStar(stars,x,y,gesture);
  if (added) {light(stars.at(-1)!);update();render();}
  if (stars.length===MAX_STARS) status('The sky is full. Undo a gesture or clear it to begin again.');
}
function nextGesture() {
  // Shared links may contain arbitrary group IDs; keep newly encoded IDs bounded.
  const groups = new Map<number, number>();
  for (const star of stars) {
    if (!groups.has(star.gesture)) groups.set(star.gesture, groups.size + 1);
    star.gesture = groups.get(star.gesture)!;
  }
  gesture = groups.size + 1;
}
function pointer(event: PointerEvent) {
  const rect = canvas.getBoundingClientRect();
  const x=(event.clientX-rect.left-bounds.left)/bounds.width, y=(event.clientY-rect.top-bounds.top)/bounds.height;
  if (x<0 || x>1 || y<0 || y>1) return;
  place(x,y);
}
canvas.addEventListener('pointerdown',event=>{
  if (!event.isPrimary || event.button!==0) return;
  drawing=event.pointerId;nextGesture();canvas.setPointerCapture(drawing);pointer(event);
}, options);
canvas.addEventListener('pointermove',event=>{if(event.pointerId===drawing) pointer(event);}, options);
for (const type of ['pointerup','pointercancel','lostpointercapture']) canvas.addEventListener(type,()=>drawing=null, options);

$('add').onclick=()=>{
  nextGesture();
  const rng=random(gesture*831+stars.length*71);
  for (let i=0;i<100;i++) {
    const before=stars.length;place(.08+rng()*.84,.08+rng()*.84);
    if(stars.length>before) break;
  }
};
$('undo').onclick=()=>{
  const last=stars.at(-1)?.gesture;
  stars=stars.filter(s=>s.gesture!==last);pulses=[];instrument.silence();update();render();
};
$('clear').onclick=()=>{
  stars=[];pulses=[];cursor=0;beat=0;gesture=0;
  instrument.silence();history.replaceState(history.state,'',location.pathname+location.search);update();render();
};
function togglePause() {
  paused=!paused;
  if(paused) instrument.silence();
  update();render();
}
$('pause').onclick=togglePause;
root.addEventListener('keydown',event=>{
  const target = event.target as HTMLElement;
  if(event.code==='Space' && !['BUTTON','INPUT','TEXTAREA','A'].includes(target.tagName) && !target.isContentEditable) {event.preventDefault();togglePause();}
}, options);
$('sound').onclick=async()=>{
  try {
    if(instrument.enabled) instrument.disable(); else await instrument.enable();
    if (disposed) return;
    $('sound').textContent=instrument.enabled?'Mute sound':'Enable sound';
    $('sound').setAttribute('aria-pressed',String(instrument.enabled));
    if(instrument.enabled && paused) status('Sound enabled. Resume the sky to hear it.');
  } catch {status('Sound could not start in this browser. The sky still works silently.');}
};
$('tempo').oninput=()=>{$('tempo-value').value=$('tempo').value;beat=0;};
$('share').onclick=async()=>{
  const url=new URL(location.href);url.hash=encode(stars);
  history.replaceState(history.state,'',url);
  try {
    if(navigator.clipboard?.writeText) await navigator.clipboard.writeText(url.href);
    else {
      const field=document.createElement('textarea');field.value=url.href;document.body.append(field);field.select();
      const copied=document.execCommand('copy');field.remove();
      if(!copied) throw new Error('Clipboard unavailable');
    }
    status('Link copied. The shape travels; the moment stays here.');
  } catch {status('Copy was blocked. Your constellation link is now in the address bar.');}
};
$('save').onclick=()=>{
  render();
  canvas.toBlob(blob=>{
    if (disposed) return;
    if(!blob) {status('This browser could not save an image.');return;}
    const url=URL.createObjectURL(blob), link=document.createElement('a');
    link.href=url;link.download='afterlight.png';link.click();
    downloads.set(url, setTimeout(()=>{URL.revokeObjectURL(url); downloads.delete(url);},10000));
    status('A little piece of sky, saved.');
  },'image/png');
};
document.addEventListener('visibilitychange',()=>{if(document.hidden) instrument.silence();}, options);
const observer = new ResizeObserver(resize);
observer.observe(root);
update();resize();animation = requestAnimationFrame(frame);
root.dataset.ready = 'true';
return () => {
  disposed = true;
  controller.abort();
  observer.disconnect();
  cancelAnimationFrame(animation);
  clearTimeout(statusTimer);
  for (const [url, timer] of downloads) {clearTimeout(timer); URL.revokeObjectURL(url);}
  for (const id of ['add','undo','clear','pause','sound','share','save'] as const) $(id).onclick = null;
  $('tempo').oninput = null;
  instrument.dispose();
  delete root.dataset.ready;
};
}
