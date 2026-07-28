import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Logo } from '@/components/Logo';
import { supabase } from '@/lib/supabaseClient';
import { consumeIdleSignoutReason } from '@/lib/idleSession';
import { useAuth } from '@/hooks/useAuth';

export function LoginPage() {
  const navigate = useNavigate();
  const { session, isLoading: isAuthLoading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showIdleNotice, setShowIdleNotice] = useState(false);
  const hasConsumedIdleReason = useRef(false);

  useEffect(() => {
    if (hasConsumedIdleReason.current) return;
    hasConsumedIdleReason.current = true;
    setShowIdleNotice(consumeIdleSignoutReason());
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setIsSubmitting(false);
    if (signInError) {
      setError(signInError.message);
      return;
    }
    navigate('/dashboard');
  }

  // An already-authenticated visitor landing here (e.g. via an email
  // confirmation link that redirects to /login) shouldn't be asked to log
  // in again.
  if (!isAuthLoading && session) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="card-surface mx-auto mt-8 max-w-sm p-8">
      <Logo size={40} className="mb-6" />
      <h1 className="mb-6 text-2xl font-extrabold">Log In</h1>
      {showIdleNotice && (
        <p className="mb-4 rounded-md border border-border bg-muted p-3 text-sm text-muted-foreground">
          You were signed out due to inactivity. Please sign in again.
        </p>
      )}
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {error && <p className="text-destructive text-sm">{error}</p>}
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Logging in…' : 'Log in'}
        </Button>
        <Link to="/forgot-password" className="text-muted-foreground text-sm hover:underline">
          Forgot password?
        </Link>
      </form>
    </div>
  );
}
