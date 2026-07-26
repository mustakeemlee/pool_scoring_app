// web/src/components/PlayerAvatar.tsx
import { useState } from 'react';
import { User } from 'lucide-react';
import { cn } from '@/lib/utils';

type AvatarSize = 'sm' | 'md' | 'lg' | 'xl';

const SIZE_CLASSES: Record<AvatarSize, string> = {
  sm: 'h-8 w-8',
  md: 'h-10 w-10',
  lg: 'h-14 w-14',
  xl: 'h-24 w-24',
};

const ICON_SIZE_CLASSES: Record<AvatarSize, string> = {
  sm: 'h-4 w-4',
  md: 'h-5 w-5',
  lg: 'h-7 w-7',
  xl: 'h-12 w-12',
};

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
        'relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full ring-2 ring-border',
        SIZE_CLASSES[size],
        !showPhoto && 'bg-muted',
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
        <User className={cn('text-muted-foreground', ICON_SIZE_CLASSES[size])} />
      )}
    </span>
  );
}
