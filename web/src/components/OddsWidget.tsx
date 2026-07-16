// web/src/components/OddsWidget.tsx
import { winProbability } from '../../../src/rating/odds';

interface OddsWidgetProps {
  playerARating: number;
  playerBRating: number;
  playerAName: string;
  playerBName: string;
}

export function OddsWidget({ playerARating, playerBRating, playerAName, playerBName }: OddsWidgetProps) {
  const probabilityA = winProbability(playerARating, playerBRating);
  const probabilityB = 1 - probabilityA;

  return (
    <div className="rounded-md border p-3 text-sm">
      <p className="text-muted-foreground mb-1 text-xs uppercase">Predicted odds</p>
      <div className="flex justify-between">
        <span>{playerAName || 'Player A'}</span>
        <span className="font-semibold">{Math.round(probabilityA * 100)}%</span>
      </div>
      <div className="flex justify-between">
        <span>{playerBName || 'Player B'}</span>
        <span className="font-semibold">{Math.round(probabilityB * 100)}%</span>
      </div>
    </div>
  );
}
