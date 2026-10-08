import {test,expect} from "@playwright/test";

const sky = (page: import("@playwright/test").Page) => page.getByRole("region", {name:"Constellation instrument"});

test.beforeEach(async ({page}) => {
  await page.goto("/afterlight");
  await expect(sky(page)).toHaveAttribute("data-ready", "true");
});

test("draw, undo a gesture, copy/reopen the constellation, pause and export",async({page,context},testInfo)=>{
  const errors: string[]=[];page.on("pageerror",e=>errors.push(e.message));
  const canvas=sky(page).locator("canvas");
  await canvas.scrollIntoViewIfNeeded();
  const box=(await canvas.boundingBox())!;
  if(testInfo.project.name.startsWith("mobile")) {
    const client=await context.newCDPSession(page);
    await client.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:box.x+box.width*.25,y:box.y+80}]});
    for(let i=1;i<=10;i++) await client.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:box.x+box.width*(.25+i*.04),y:box.y+80+i*12}]});
    await client.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
  } else {
    await page.mouse.move(box.x+box.width*.2,box.y+90);await page.mouse.down();
    await page.mouse.move(box.x+box.width*.65,box.y+200,{steps:20});await page.mouse.up();
  }
  const count=await page.locator("#afterlight-count").textContent();
  expect(parseInt(count!)).toBeGreaterThan(3);
  await sky(page).getByRole("button",{name:"Add a star",exact:true}).click();
  await expect(page.locator("#afterlight-count")).not.toHaveText(count!);
  await sky(page).getByRole("button",{name:"Undo",exact:true}).click();
  await expect(page.locator("#afterlight-count")).toHaveText(count!);
  await sky(page).getByRole("button",{name:"Copy link"}).click();
  expect(new URL(page.url()).hash).toContain("v1.");
  await page.reload();await expect(sky(page)).toHaveAttribute("data-ready","true");
  await expect(page.locator("#afterlight-count")).toHaveText(count!);
  await page.getByRole("slider",{name:"Pace",exact:true}).fill("90");
  await expect(page.locator("#afterlight-tempo-value")).toHaveText("90");
  await sky(page).getByRole("button",{name:"Pause",exact:true}).click();
  const frozen=await canvas.evaluate(c=>(c as HTMLCanvasElement).toDataURL());
  await page.waitForTimeout(100);
  expect(await canvas.evaluate(c=>(c as HTMLCanvasElement).toDataURL())).toBe(frozen);
  const downloadPromise=page.waitForEvent("download");
  await sky(page).getByRole("button",{name:"Save image"}).click();
  const download=await downloadPromise;
  expect(download.suggestedFilename()).toBe("afterlight.png");
  const stream=await download.createReadStream();
  const chunks: Buffer[]=[];for await(const chunk of stream!) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks).subarray(0,8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  if(process.env.AFTERLIGHT_SCREENSHOTS) {
    await expect(page.locator("#afterlight-invitation")).toHaveCSS("opacity","0");
    await page.screenshot({path:testInfo.outputPath("afterlight.png"),fullPage:true});
  }
  await sky(page).getByRole("button",{name:"Clear",exact:true}).click();
  await expect(page.locator("#afterlight-count")).toHaveText("0 stars");
  expect(new URL(page.url()).hash).toBe("");
  await expect(sky(page).getByRole("button",{name:"Undo",exact:true})).toBeDisabled();
  expect(errors).toEqual([]);
});

test("reduced motion, keyboard input and malformed links",async({page})=>{
  await page.emulateMedia({reducedMotion:"reduce"});
  await page.goto("/afterlight#broken");
  await expect(page.locator("#afterlight-status")).toContainText("not supported");
  await expect(page.locator("#afterlight-pause")).toHaveText("Resume");
  await page.locator("#afterlight-add").focus();await page.keyboard.press("Enter");
  await expect(page.locator("#afterlight-count")).toHaveText("1 star");
  await page.locator("canvas").focus();await page.keyboard.press("Space");
  await expect(page.locator("#afterlight-pause")).toHaveText("Pause");
});

test("opt-in audio produces a signal and closes when leaving the tool",async({page})=>{
  await page.addInitScript(()=>{
    const Original=window.AudioContext;
    const globals=window as unknown as {testAudio:AudioContext; testGains:GainNode[]};
    window.AudioContext=class extends Original {
      constructor(...args: ConstructorParameters<typeof AudioContext>){super(...args);globals.testAudio=this;globals.testGains=[];}
      createGain(){const gain=super.createGain();globals.testGains.push(gain);return gain;}
    };
  });
  await page.reload();await expect(sky(page)).toHaveAttribute("data-ready","true");
  await page.locator("#afterlight-add").click();
  expect(await page.evaluate(()=>Boolean((window as unknown as {testAudio?:AudioContext}).testAudio))).toBe(false);
  await page.locator("#afterlight-sound").click();
  await expect(page.locator("#afterlight-sound")).toHaveText("Mute sound");
  await page.evaluate(()=>{
    const globals=window as unknown as {testAudio:AudioContext;testGains:GainNode[];meter:AnalyserNode};
    globals.meter=globals.testAudio.createAnalyser();globals.meter.fftSize=2048;globals.testGains[0].connect(globals.meter);
  });
  await expect.poll(()=>page.evaluate(()=>{
    const {meter}=window as unknown as {meter:AnalyserNode};
    const data=new Float32Array(meter.fftSize);meter.getFloatTimeDomainData(data);
    return Math.max(...data.map(Math.abs));
  }),{timeout:5000}).toBeGreaterThan(.001);
  await page.getByRole("link",{name:/Michael F\. Bryan/}).click();
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {testAudio:AudioContext}).testAudio.state)).toBe("closed");
  await page.getByRole("link",{name:/Afterlight/}).click();
  await expect(sky(page)).toHaveAttribute("data-ready","true");
  await page.locator("#afterlight-add").click();
  await expect(page.locator("#afterlight-count")).toHaveText("1 star");
});

// The runner starts with analytics enabled; shared sky data must stay out of its queue.
test("shared constellations do not enter analytics defaults",async({page})=>{
  test.skip(Boolean(process.env.PLAYWRIGHT_BASE_URL) && process.env.PLAYWRIGHT_VERIFY_ANALYTICS!=="1","analytics-enabled server required");
  const shape="v1.123,456,1;345,678,1";
  await page.goto(`/afterlight#${shape}`);
  await expect(page.locator("#afterlight-count")).toHaveText("2 stars");
  const values=()=>page.evaluate(()=>{
    const entries=(window as unknown as {dataLayer?:ArrayLike<unknown>[]}).dataLayer??[];
    return entries.map(entry=>Array.from(entry));
  });
  await expect.poll(async()=>(await values()).filter(v=>v[0]==="set").length).toBeGreaterThan(0);
  await page.locator("#afterlight-share").click();
  const queue=JSON.stringify(await values());
  expect(queue).not.toContain(shape);expect(queue).not.toContain("123,456");
  await page.getByRole("link",{name:/Michael F\. Bryan/}).click();
  await expect(page).toHaveURL(/\/$/);
  expect(JSON.stringify(await values())).not.toContain(shape);
});
