// Phone notifications through Firebase Cloud Messaging. The scheduled GitHub Action (scripts/notify.mjs)
// decides what to send; this file only gets permission and registers the device.
import { getMessaging, getToken, deleteToken, isSupported } from 'firebase/messaging';
import * as store from './store.js';

const KEY = 'ff-push-device';
const readLocal = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const writeLocal = (v) => { try { if (v) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY); } catch { /* storage blocked */ } };

const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

// 'ios-install' | 'unsupported' | 'denied' | 'off' | 'on'
export async function pushStatus() {
  const basics = 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
  if (!basics) return isIos && !standalone() ? 'ios-install' : 'unsupported';
  if (!(await isSupported().catch(() => false))) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return Notification.permission === 'granted' && readLocal() ? 'on' : 'off';
}

const deviceLabel = () => {
  const ua = navigator.userAgent;
  if (/iphone/i.test(ua)) return 'iPhone';
  if (/ipad/i.test(ua) || isIos) return 'iPad';
  if (/android/i.test(ua)) return 'Android';
  return 'Computer';
};

async function registerToken() {
  const reg = await navigator.serviceWorker.register('sw.js');
  await navigator.serviceWorker.ready;
  const token = await getToken(getMessaging(store.fbApp), { serviceWorkerRegistration: reg });
  if (!token) throw new Error('Could not get a notification token.');
  const id = await store.saveDevice(token, deviceLabel());
  writeLocal(id);
  return id;
}

// Must run from a tap: browsers only show the permission prompt in response to one.
export async function enablePush(user) {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(perm === 'denied' ? 'Notifications are blocked for FitFriends in your settings.' : 'Notifications were not allowed.');
  await registerToken();
  if (user.tz !== timeZone()) await store.updateProfile({ tz: timeZone() });
}

export async function disablePush() {
  const id = readLocal();
  writeLocal(null);
  await deleteToken(getMessaging(store.fbApp)).catch(() => {});
  if (id) await store.removeDevice(id).catch(() => {});
}

// Tokens can change; refresh quietly on app start when notifications are already on.
export async function refreshPush(user) {
  if ((await pushStatus()) !== 'on') return;
  await registerToken().catch(() => {});
  if (user.tz !== timeZone()) await store.updateProfile({ tz: timeZone() }).catch(() => {});
}

// Shows a notification right away from this phone, to check that they display.
export async function testPush() {
  const reg = await navigator.serviceWorker.ready;
  await reg.showNotification('FitFriends', { body: 'Notifications are working.', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'test' });
}
