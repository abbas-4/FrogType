import { Bird, Bug, Cat, Dog, Fish, Ghost, Panda, Rabbit, Snail, Squirrel, Turtle, type LucideIcon } from 'lucide-react';
import { isAvatar, type AvatarKey } from '../domain/avatars';

const icons: Record<Exclude<AvatarKey, 'frog'>, LucideIcon> = {
  cat: Cat,
  dog: Dog,
  bird: Bird,
  fish: Fish,
  rabbit: Rabbit,
  turtle: Turtle,
  squirrel: Squirrel,
  snail: Snail,
  bug: Bug,
  panda: Panda,
  ghost: Ghost,
};

const sizes = { sm: 'h-7 w-7 text-xs', md: 'h-10 w-10 text-sm', lg: 'h-16 w-16 text-2xl' } as const;
const iconPx = { sm: 16, md: 22, lg: 34 } as const;

/** Decorative picture for a user: a built-in avatar, or their initials. The username next to it carries the meaning. */
export function Avatar({ avatar, username, size = 'md' }: { avatar?: string | null; username: string; size?: keyof typeof sizes }) {
  const box = `inline-flex shrink-0 items-center justify-center rounded-full bg-brand/15 font-semibold text-brand ${sizes[size]}`;
  if (avatar === 'frog') {
    return (
      <span className={box} aria-hidden="true" data-avatar="frog">
        <img src="/favicon.svg" alt="" className="h-3/5 w-3/5" />
      </span>
    );
  }
  const Icon = isAvatar(avatar) && avatar !== 'frog' ? icons[avatar] : null;
  return (
    <span className={box} aria-hidden="true" data-avatar={Icon ? avatar : 'initials'}>
      {Icon ? <Icon size={iconPx[size]} /> : username.slice(0, 2).toUpperCase()}
    </span>
  );
}
