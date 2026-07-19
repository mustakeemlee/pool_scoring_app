// web/src/components/RatingChart.tsx
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { RatingHistoryPoint } from '@/lib/ratingHistory';

export function RatingChart({ points }: { points: RatingHistoryPoint[] }) {
  if (points.length === 0) {
    return <p className="text-muted-foreground text-sm">No rating history yet.</p>;
  }

  return (
    <div
      data-testid="rating-chart"
      role="img"
      aria-label={`Rating history over ${points.length} data points, from ${points[0].rating} to ${points[points.length - 1].rating}`}
      style={{ width: '100%', height: 200 }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" />
          <YAxis domain={['dataMin - 50', 'dataMax + 50']} />
          <Tooltip />
          <Line type="monotone" dataKey="rating" stroke="#2563eb" dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
