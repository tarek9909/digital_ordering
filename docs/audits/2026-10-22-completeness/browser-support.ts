import AxeBuilder from '../../../frontend/node_modules/@axe-core/playwright';
import { expect, request, type Browser, type BrowserContextOptions, type Page } from '../../../frontend/node_modules/@playwright/test';
export const DOMAIN='dop.localhost';
export const SLUG='burger-house';
export const PIN='4821';
export const url={
  customer:(p='')=>`http://t.${DOMAIN}:5273${p}`,
  staff:(p='')=>`http://${SLUG}.${DOMAIN}:5274/staff${p}`,
  admin:(p='')=>`http://${SLUG}.${DOMAIN}:5276/admin${p}`,
};
export async function expectAccessible(page:Page){
  const r=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
  expect(r.violations.map(v=>`${v.id}: ${v.help} â€” ${v.nodes.map(n=>n.target.join(' ')).join(', ')}`)).toEqual([]);
}
export async function staffLink(){
  const api=await request.newContext({baseURL:'http://127.0.0.1:4400',extraHTTPHeaders:{Host:`${SLUG}.${DOMAIN}`}});
  try{
    expect((await api.post('/api/auth/v1/sign-in',{data:{email:'owner@burger-house.localhost',password:'dev-password-123'}})).ok()).toBeTruthy();
    const venues=await (await api.get('/api/admin/v1/venues')).json();
    return (await (await api.get(`/api/admin/v1/venues/${venues.items[0].id}/staff-access`)).json()).link as string;
  }finally{await api.dispose();}
}
export async function signInStaff(page:Page,link:string,name:string){
  await page.addInitScript(()=>localStorage.setItem('dop.staff.lang','en'));
  await page.goto(link);
  if(await page.getByLabel('Device name').isVisible().catch(()=>false)) await page.getByLabel('Device name').fill(name);
  for(const d of PIN) await page.getByRole('button',{name:d,exact:true}).click();
  await page.getByRole('button',{name:'Open board'}).click();
  await expect(page.getByRole('button',{name:'New ticket'})).toBeVisible();
}
export async function unlockPersonalPin(page:Page){
  const dialog=page.getByRole('dialog',{name:'Enter your personal PIN',exact:true});
  try{await dialog.waitFor({state:'visible',timeout:1500});}catch{return;}
  for(const d of '5937') await dialog.getByRole('button',{name:d,exact:true}).click();
  await dialog.getByRole('button',{name:'Continue',exact:true}).click();
}
let state:BrowserContextOptions['storageState'];
export async function staffDevice(browser:Browser):Promise<BrowserContextOptions>{
  if(!state){const ctx=await browser.newContext({locale:'en-US'});await signInStaff(await ctx.newPage(),await staffLink(),'Audit E2E counter');state=await ctx.storageState();await ctx.close();}
  return {storageState:state};
}

