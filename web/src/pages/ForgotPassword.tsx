// web/src/pages/ForgotPassword.tsx
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/supabaseClient';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setIsSubmitting(false);
    if (resetError) {
      setError(resetError.message);
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <div className="card-surface mx-auto mt-8 max-w-sm p-8">
        <div className="fpl-gradient mb-6 h-1 w-12 rounded-full" />
      <h1 className="mb-6 text-2xl font-extrabold">Forgot Password</h1>
        <p className="text-sm">Check your email for a password reset link.</p>
      </div>
    );
  }

  return (
    <div className="card-surface mx-auto mt-8 max-w-sm p-8">
      <div className="fpl-gradient mb-6 h-1 w-12 rounded-full" />
      <h1 className="mb-6 text-2xl font-extrabold">Forgot Password</h1>
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        {error && <p className="text-destructive text-sm">{error}</p>}
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Sending…' : 'Send reset link'}
        </Button>
      </form>
    </div>
  );
}
