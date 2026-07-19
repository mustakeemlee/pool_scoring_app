// web/src/components/PlayerAvatar.tsx
import { useState } from 'react';
import { cn } from '@/lib/utils';

type AvatarSize = 'sm' | 'md' | 'lg' | 'xl';

const SIZE_CLASSES: Record<AvatarSize, string> = {
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-14 w-14 text-lg',
  xl: 'h-24 w-24 text-3xl',
};

// Deterministic gradient per player so avatars stay stable between renders.
const GRADIENTS = [
  'from-[#963cff] to-[#04f5ff]',
  'from-[#ff2882] to-[#963cff]',
  'from-[#04f5ff] to-[#00ff87]',
  'from-[#ff2882] to-[#04f5ff]',
  'from-[#00ff87] to-[#963cff]',
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function gradientFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return GRADIENTS[hash % GRADIENTS.length];
}

export interface PlayerAvatarProps {
  name: string;
  photoUrl?: string | null;
  size?: AvatarSize;
  className?: string;
}

export function PlayerAvatar({ name, photoUrl, size = 'md', className }: PlayerAvatarProps) {
  const [failed, setFailed] = useState(false);
  const showPhoto = photoUrl && !failed;

  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full ring-2 ring-white/15',
        SIZE_CLASSES[size],
        !showPhoto && cn('bg-gradient-to-br font-bold text-white', gradientFor(name)),
        className,
      )}
      aria-hidden={showPhoto ? undefined : true}
    >
      {showPhoto ? (
        <img
          src={photoUrl}
          alt={name}
          className="h-full w-full object-cover"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        initials(name)
      )}
    </span>
  );
}
