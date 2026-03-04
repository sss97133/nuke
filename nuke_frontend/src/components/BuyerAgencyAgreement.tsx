import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { Database } from '../types/supabase';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Checkbox } from '../components/ui/checkbox';
import '../styles/unified-design-system.css';

type Profile = Database['public']['Tables']['profiles']['Row'];

const BuyerAgencyAgreementContent: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [fullName, setFullName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [zip, setZip] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [agreeToTerms, setAgreeToTerms] = useState(false);
  const [agreeToFees, setAgreeToFees] = useState(false);
  const [agreeToExclusive, setAgreeToExclusive] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const loadProfile = async () => {
      if (!user) return;
      
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();
        
      if (data && !error) {
        setFullName(data.full_name || '');
        setEmail(user.email || '');
      }
    };
    
    loadProfile();
  }, [user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!agreeToTerms || !agreeToFees || !agreeToExclusive) {
      setError('Please agree to all terms before submitting.');
      return;
    }
    
    setIsSubmitting(true);
    setError(null);
    
    try {
      if (!user) throw new Error('Must be logged in');
      
      const { error: submitError } = await supabase
        .from('buyer_agreements')
        .insert({
          user_id: user.id,
          full_name: fullName,
          date_of_birth: dateOfBirth,
          address,
          city,
          state,
          zip,
          email,
          phone,
          agreed_to_terms: agreeToTerms,
          agreed_to_fees: agreeToFees,
          agreed_to_exclusive: agreeToExclusive,
          signed_at: new Date().toISOString(),
        });
        
      if (submitError) throw submitError;
      
      setSuccess(true);
      setTimeout(() => navigate('/dashboard'), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (success) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <h2>Agreement Signed Successfully</h2>
        <p>Redirecting to dashboard...</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '40px 20px' }}>
      <h1 style={{ marginBottom: '24px' }}>Buyer Agency Agreement</h1>
      
      <div style={{ 
        backgroundColor: 'var(--bg-secondary)', 
        padding: '24px', 
        borderRadius: '8px',
        marginBottom: '32px',
        fontSize: '14px',
        lineHeight: '1.6'
      }}>
        <h2 style={{ marginBottom: '16px', fontSize: '18px' }}>Terms and Conditions</h2>
        <p style={{ marginBottom: '12px' }}>
          This Buyer Agency Agreement ("Agreement") is entered into between Nuke Marketplace ("Agency") 
          and the undersigned buyer ("Client"). This Agreement establishes the terms under which the 
          Agency will represent the Client in the purchase of vehicles.
        </p>
        <p style={{ marginBottom: '12px' }}>
          <strong>Services:</strong> The Agency agrees to provide buyer representation services, 
          including vehicle search, price negotiation, and purchase facilitation.
        </p>
        <p style={{ marginBottom: '12px' }}>
          <strong>Fees:</strong> Client agrees to pay a buyer's premium of 2.5% of the final 
          purchase price for any vehicle acquired through Agency's services.
        </p>
        <p>
          <strong>Exclusivity:</strong> During the term of this Agreement, Client agrees to work 
          exclusively through Agency for vehicle purchases within the agreed parameters.
        </p>
      </div>
      
      <form onSubmit={handleSubmit}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '24px' }}>
          <div>
            <Label htmlFor="fullName">Full Legal Name</Label>
            <Input
              id="fullName"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="dateOfBirth">Date of Birth</Label>
            <Input
              id="dateOfBirth"
              type="date"
              value={dateOfBirth}
              onChange={(e) => setDateOfBirth(e.target.value)}
              required
            />
          </div>
          <div style={{ gridColumn: 'span 2' }}>
            <Label htmlFor="address">Street Address</Label>
            <Input
              id="address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="city">City</Label>
            <Input
              id="city"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              required
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <Label htmlFor="state">State</Label>
              <Input
                id="state"
                value={state}
                onChange={(e) => setState(e.target.value)}
                maxLength={2}
                required
              />
            </div>
            <div>
              <Label htmlFor="zip">ZIP Code</Label>
              <Input
                id="zip"
                value={zip}
                onChange={(e) => setZip(e.target.value)}
                required
              />
            </div>
          </div>
          <div>
            <Label htmlFor="email">Email Address</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="phone">Phone Number</Label>
            <Input
              id="phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
            />
          </div>
        </div>
        
        <div style={{ marginBottom: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
            <Checkbox
              id="agreeToTerms"
              checked={agreeToTerms}
              onCheckedChange={(checked) => setAgreeToTerms(!!checked)}
            />
            <Label htmlFor="agreeToTerms" style={{ cursor: 'pointer', lineHeight: '1.5' }}>
              I have read and agree to the terms and conditions of this Buyer Agency Agreement
            </Label>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
            <Checkbox
              id="agreeToFees"
              checked={agreeToFees}
              onCheckedChange={(checked) => setAgreeToFees(!!checked)}
            />
            <Label htmlFor="agreeToFees" style={{ cursor: 'pointer', lineHeight: '1.5' }}>
              I agree to the buyer's premium fee structure (2.5% of final purchase price)
            </Label>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
            <Checkbox
              id="agreeToExclusive"
              checked={agreeToExclusive}
              onCheckedChange={(checked) => setAgreeToExclusive(!!checked)}
            />
            <Label htmlFor="agreeToExclusive" style={{ cursor: 'pointer', lineHeight: '1.5' }}>
              I agree to the exclusivity clause and will work exclusively through Nuke Marketplace 
              for vehicle purchases during the term of this agreement
            </Label>
          </div>
        </div>
        
        {error && (
          <div style={{ 
            backgroundColor: 'var(--error-bg, #fee)', 
            color: 'var(--error, #c00)',
            padding: '12px 16px',
            borderRadius: '6px',
            marginBottom: '16px',
            fontSize: '14px'
          }}>
            {error}
          </div>
        )}
        
        <Button type="submit" disabled={isSubmitting} style={{ width: '100%', padding: '12px' }}>
          {isSubmitting ? 'Submitting...' : 'Sign Agreement'}
        </Button>
      </form>
    </div>
  );
};

const BuyerAgencyAgreement: React.FC = () => (
  <ErrorBoundary>
    <BuyerAgencyAgreementContent />
  </ErrorBoundary>
);

export default BuyerAgencyAgreement;
