import { BookOpen, Crown, Flag, Flame, Star, Target, Trophy, Zap } from 'lucide-react';
import type { Achievement } from '../domain/achievements';

const icons = { flag: Flag, target: Target, zap: Zap, flame: Flame, trophy: Trophy, book: BookOpen, star: Star, crown: Crown };

export function AchievementIcon({ icon, size = 20 }: { icon: Achievement['icon']; size?: number }) {
  const Icon = icons[icon];
  return <Icon size={size} aria-hidden="true" />;
}
