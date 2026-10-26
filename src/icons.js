// Line icons from Lucide (ISC license), bundled so only the ones used ship.
import {
  House, Dumbbell, Utensils, Trophy, User, Plus, X, ChevronLeft, ChevronRight, Flame, Timer, Zap, Target,
  Download, Shield, LogOut, Share, Footprints, PersonStanding, Bike, Waves, Leaf, Mountain, Volleyball, Music,
  Sailboat, MountainSnow, MoveHorizontal, Activity, Medal, Crown, Salad, Shuffle, Sparkles, Hash, Gauge, Star,
  SquarePlus, Smartphone, Check, Trash2, Users, KeyRound, Ban, TrendingUp, CalendarDays, Copy,
  Minus, Scale, GlassWater, Search, Pencil, Repeat, ChevronDown, HeartPulse, Ruler, Calculator, Route,
  History, Info, ArrowUpRight, ArrowDownRight, Settings, Goal,
  Play, Pause, SkipForward, SkipBack, Volume2, VolumeX, ChevronUp, ListOrdered, Share2, Flag, RotateCcw,
  AudioLines, Library, BookmarkPlus, Hourglass, Lock, Globe,
} from 'lucide';

const ICONS = {
  home: House, train: Dumbbell, fuel: Utensils, arena: Trophy, user: User, plus: Plus, x: X,
  left: ChevronLeft, right: ChevronRight, flame: Flame, timer: Timer, zap: Zap, target: Target,
  download: Download, shield: Shield, logout: LogOut, share: Share, crown: Crown, star: Star,
  squarePlus: SquarePlus, phone: Smartphone, check: Check, trash: Trash2, users: Users, key: KeyRound,
  ban: Ban, trend: TrendingUp, calendar: CalendarDays, copy: Copy, medal: Medal, sparkles: Sparkles,
  hash: Hash, gauge: Gauge, salad: Salad, shuffle: Shuffle, activity: Activity,
  minus: Minus, scale: Scale, water: GlassWater, search: Search, edit: Pencil, repeat: Repeat, down: ChevronDown,
  heart: HeartPulse, ruler: Ruler, calc: Calculator, route: Route, history: History, info: Info,
  up: ArrowUpRight, downRight: ArrowDownRight, settings: Settings, goal: Goal,
  play: Play, pause: Pause, skip: SkipForward, prev: SkipBack, sound: Volume2, mute: VolumeX, upChev: ChevronUp,
  list: ListOrdered, shareOut: Share2, flag: Flag, reset: RotateCcw, voice: AudioLines, library: Library,
  save: BookmarkPlus, hourglass: Hourglass, lock: Lock, globe: Globe,
  // workout types
  Running: Footprints, Walking: PersonStanding, Cycling: Bike, Swimming: Waves, Weightlifting: Dumbbell,
  HIIT: Zap, Yoga: Leaf, Hiking: Mountain, Sports: Volleyball, Dance: Music, Rowing: Sailboat,
  Climbing: MountainSnow, Stretching: MoveHorizontal, Other: Activity,
};

const attrs = (o) => Object.entries(o).map(([k, v]) => `${k}="${v}"`).join(' ');

export function icon(name, size = 20, extraClass = '') {
  const node = ICONS[name] || Activity;
  const body = node.map(([tag, a]) => `<${tag} ${attrs(a)}/>`).join('');
  return `<svg class="i ${extraClass}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}
