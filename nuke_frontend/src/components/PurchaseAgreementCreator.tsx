import React, { useState, useEffect } from 'react';
import { Card } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { Badge } from './ui/badge';
import { Checkbox } from './ui/checkbox';

interface Vehicle {
  id: string;
  year: number;
  make: string;
  model: string;
  vin: string;
  color: string;
  mileage: number;
  user_id: string;
  current_value?: number;
}

interface PurchaseAgreement {
  id: string;
  status: 'draft' | 'pending_buyer' | 'pending_signatures' | 'completed' | 'cancelled';
  vehicle_sales_price: number;
  seller_name: string;
  buyer_name?: string;
  total_gross_proceeds: number;
  balance_due: number;
  agreement_date: string;
  signature_status: {
    buyer_signed: boolean;
    seller_signed: boolean;
    co_buyer_signed: boolean;
  };
}

interface PurchaseAgreementCreatorProps {
  vehicle: Vehicle;
  userProfile: {
    id: string;
    full_name: string;
    email: string;
    phone?: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
  onAgreementCreated?: (agreement: PurchaseAgreement) => void;
}

export default function PurchaseAgreementCreator({
  vehicle,
  userProfile,
  onAgreementCreated
}: PurchaseAgreementCreatorProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [agreement, setAgreement] = useState<PurchaseAgreement | null>(null);
  const [formData, setFormData] = useState({
    vehicle_sales_price: vehicle.current_value || 0,
    document_fee: 199,
    dealer_handling_fee: 299,
    sales_tax_rate: 8.25,
    warranty_declined: false,
    salesman_name: userProfile.full_name,
    // Buyer information (when adding buyer)
    buyer_name: '',
    buyer_email: '',
    buyer_phone: '',
    buyer_address: '',
    buyer_city: '',
    buyer_state: '',
    buyer_zip: '',
    // Trade-in information
    tradein_year: '',
    tradein_make: '',
    tradein_model: '',
    tradein_vin: '',
    tradein_credit_value: 0,
    tradein_payoff_amount: 0,
    // Financing information
    loan_from: '',
    loan_amount: 0,
    annual_percentage_rate: 0,
    installment_amount: 0,
    payment_frequency: 'monthly'
  });

  const [activeTab, setActiveTab] = useState<'create' | 'buyer' | 'financing' | 'review'>('create');

  const createPurchaseAgreement = async () => {
    setIsCreating(true);
    try {
      const response = await fetch(`/api/vehicles/${vehicle.id}/purchase-agreements`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          vehicle_id: vehicle.id,
          seller_user_id: userProfile.id,
          vehicle_sales_price: formData.vehicle_sales_price,
          document_fee: formData.document_fee,
          dealer_handling_fee: formData.dealer_handling_fee,
          sales_tax_rate: formData.sales_tax_rate / 100, // Convert percentage to decimal
          warranty_declined: formData.warranty_declined,
          salesman_name: formData.salesman_name
        })
      });

      if (response.ok) {
        const result = await response.json();
        setAgreement(result.agreement);
        onAgreementCreated?.(result.agreement);
      } else {
        console.error('Failed to create purchase agreement');
      }
    } catch (error) {
      console.error('Error creating purchase agreement:', error);
    } finally {
      setIsCreating(false);
    }
  };

  const addBuyerToAgreement = async () => {
    if (!agreement) return;

    try {
      const response = await fetch(`/api/purchase-agreements/${agreement.id}/buyer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          buyer_info: {
            name: formData.buyer_name,
            email: formData.buyer_email,
            phone: formData.buyer_phone,
            address: formData.buyer_address,
            city: formData.buyer_city,
            state: formData.buyer_state,
            zip: formData.buyer_zip
          }
        })
      });

      if (response.ok) {
        const result = await response.json();
        setAgreement(result.agreement);
        setActiveTab('review');
      }
    } catch (error) {
      console.error('Error adding buyer:', error);
    }
  };

  const generatePDF = async () => {
    if (!agreement) return;

    try {
      const response = await fetch(`/api/purchase-agreements/${agreement.id}/pdf`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `purchase_agreement_${agreement.id}.pdf`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }
    } catch (error) {
      console.error('Error generating PDF:', error);
    }
  };

  const viewHTML = async () => {
    if (!agreement) return;

    try {
      const response = await fetch(`/api/purchase-agreements/${agreement.id}/html`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      });

      if (response.ok) {
        const result = await response.json();
        const newWindow = window.open('', '_blank');
        if (newWindow) {
          newWindow.document.write(result.html);
          newWindow.document.close();
        }
      }
    } catch (error) {
      console.error('Error viewing HTML:', error);
    }
  };

  const handleInputChange = (field: string, value: any) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const calculateTotal = () => {
    const subtotal = formData.vehicle_sales_price + formData.document_fee + formData.dealer_handling_fee;
    const salesTax = subtotal * (formData.sales_tax_rate / 100);
    const tradeinNet = formData.tradein_credit_value - formData.tradein_payoff_amount;
    return subtotal + salesTax - tradeinNet;
  };

  if (agreement) {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold">Purchase Agreement</h2>
          <Badge variant={
            agreement.status === 'completed' ? 'default' :
            agreement.status === 'pending_signatures' ? 'secondary' :
            'outline'
          }>
            {agreement.status.replace('_', ' ').toUpperCase()}
          </Badge>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          <div>
            <h3 className="text-lg font-semibold mb-2">Vehicle Information</h3>
            <p className="text-sm text-gray-600">
              {vehicle.year} {vehicle.make} {vehicle.model}<br />
              VIN: {vehicle.vin}<br />
              Color: {vehicle.color}<br />
              Mileage: {vehicle.mileage?.toLocaleString()}
            </p>
          </div>

          <div>
            <h3 className="text-lg font-semibold mb-2">Agreement Details</h3>
            <p className="text-sm text-gray-600">
              Sales Price: ${agreement.vehicle_sales_price?.toLocaleString()}<br />
              Total Amount: ${agreement.total_gross_proceeds?.toLocaleString()}<br />
              Balance Due: ${agreement.balance_due?.toLocaleString()}<br />
              Date: {new Date(agreement.agreement_date).toLocaleDateString()}
            </p>
          </div>
        </div>

        <div className="mb-6">
          <h3 className="text-lg font-semibold mb-2">Signature Status</h3>
          <div className="flex gap-4">
            <Badge variant={agreement.signature_status.seller_signed ? 'default' : 'outline'}>
              Seller {agreement.signature_status.seller_signed ? '✓' : '○'}
            </Badge>
            <Badge variant={agreement.signature_status.buyer_signed ? 'default' : 'outline'}>
              Buyer {agreement.signature_status.buyer_signed ? '✓' : '○'}
            </Badge>
            {agreement.signature_status.co_buyer_signed !== null && (
              <Badge variant={agreement.signature_status.co_buyer_signed ? 'default' : 'outline'}>
                Co-Buyer {agreement.signature_status.co_buyer_signed ? '✓' : '○'}
              </Badge>
            )}
          </div>
        </div>

        {!agreement.buyer_name && (
          <div className="mb-4">
            <Button onClick={() => setActiveTab('buyer')} className="mr-2">
              Add Buyer
            </Button>
          </div>
        )}

        <div className="flex gap-2">
          <Button onClick={viewHTML} variant="outline">
            View Agreement
          </Button>
          <Button onClick={generatePDF} variant="outline">
            Download PDF
          </Button>
          {agreement.status === 'pending_signatures' && (
            <Button className="bg-green-600 hover:bg-green-700">
              Sign Agreement
            </Button>
          )}
        </div>

        {/* Add Buyer Modal/Form */}
        {activeTab === 'buyer' && !agreement.buyer_name && (
          <div className="mt-6 p-4 border rounded-lg">
            <h3 className="text-lg font-semibold mb-4">Add Buyer Information</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="buyer_name">Full Name</Label>
                <Input
                  id="buyer_name"
                  value={formData.buyer_name}
                  onChange={(e) => handleInputChange('buyer_name', e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="buyer_email">Email</Label>
                <Input
                  id="buyer_email"
                  type="email"
                  value={formData.buyer_email}
                  onChange={(e) => handleInputChange('buyer_email', e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="buyer_phone">Phone</Label>
                <Input
                  id="buyer_phone"
                  value={formData.buyer_phone}
                  onChange={(e) => handleInputChange('buyer_phone', e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="buyer_address">Address</Label>
                <Input
                  id="buyer_address"
                  value={formData.buyer_address}
                  onChange={(e) => handleInputChange('buyer_address', e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="buyer_city">City</Label>
                <Input
                  id="buyer_city"
                  value={formData.buyer_city}
                  onChange={(e) => handleInputChange('buyer_city', e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="buyer_state">State</Label>
                <Input
                  id="buyer_state"
                  value={formData.buyer_state}
                  onChange={(e) => handleInputChange('buyer_state', e.target.value)}
                />
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <Button onClick={addBuyerToAgreement}>Add Buyer</Button>
              <Button onClick={() => setActiveTab('review')} variant="outline">
                Cancel
              </Button>
            </div>
          </div>
        )}
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <h2 className="text-2xl font-bold mb-4">Create Purchase Agreement</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div>
          <h3 className="text-lg font-semibold mb-2">Vehicle Information</h3>
          <p className="text-sm text-gray-600 mb-4">
            {vehicle.year} {vehicle.make} {vehicle.model}<br />
            VIN: {vehicle.vin}<br />
            Color: {vehicle.color}<br />
            Mileage: {vehicle.mileage?.toLocaleString()}
          </p>
        </div>

        <div>
          <h3 className="text-lg font-semibold mb-2">Seller Information</h3>
          <p className="text-sm text-gray-600">
            {userProfile.full_name}<br />
            {userProfile.email}<br />
            {userProfile.phone && `${userProfile.phone}`}
          </p>
        </div>
      </div>

      <div className="space-y-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="vehicle_sales_price">Vehicle Sales Price ($)</Label>
            <Input
              id="vehicle_sales_price"
              type="number"
              value={formData.vehicle_sales_price}
              onChange={(e) => handleInputChange('vehicle_sales_price', parseFloat(e.target.value) || 0)}
            />
          </div>
          <div>
            <Label htmlFor="document_fee">Document Fee ($)</Label>
            <Input
              id="document_fee"
              type="number"
              value={formData.document_fee}
              onChange={(e) => handleInputChange('document_fee', parseFloat(e.target.value) || 0)}
            />
          </div>
          <div>
            <Label htmlFor="dealer_handling_fee">Dealer Handling Fee ($)</Label>
            <Input
              id="dealer_handling_fee"
              type="number"
              value={formData.dealer_handling_fee}
              onChange={(e) => handleInputChange('dealer_handling_fee', parseFloat(e.target.value) || 0)}
            />
          </div>
          <div>
            <Label htmlFor="sales_tax_rate">Sales Tax Rate (%)</Label>
            <Input
              id="sales_tax_rate"
              type="number"
              step="0.01"
              value={formData.sales_tax_rate}
              onChange={(e) => handleInputChange('sales_tax_rate', parseFloat(e.target.value) || 0)}
            />
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <Checkbox
            id="warranty_declined"
            checked={formData.warranty_declined}
            onCheckedChange={(checked) => handleInputChange('warranty_declined', checked)}
          />
          <Label htmlFor="warranty_declined">
            Buyer declines extended warranty
          </Label>
        </div>

        <div>
          <Label htmlFor="salesman_name">Salesperson Name</Label>
          <Input
            id="salesman_name"
            value={formData.salesman_name}
            onChange={(e) => handleInputChange('salesman_name', e.target.value)}
          />
        </div>
      </div>

      <div className="mb-6 p-4 bg-gray-50 rounded-lg">
        <h4 className="font-semibold mb-2">Estimated Total</h4>
        <div className="text-sm space-y-1">
          <div className="flex justify-between">
            <span>Vehicle Sales Price:</span>
            <span>${formData.vehicle_sales_price.toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span>Document Fee:</span>
            <span>${formData.document_fee.toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span>Dealer Handling Fee:</span>
            <span>${formData.dealer_handling_fee.toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span>Sales Tax ({formData.sales_tax_rate}%):</span>
            <span>${Math.round((formData.vehicle_sales_price + formData.document_fee + formData.dealer_handling_fee) * (formData.sales_tax_rate / 100)).toLocaleString()}</span>
          </div>
          <hr className="my-2" />
          <div className="flex justify-between font-semibold">
            <span>Total Estimated Amount:</span>
            <span>${calculateTotal().toLocaleString()}</span>
          </div>
        </div>
      </div>

      <Button
        onClick={createPurchaseAgreement}
        disabled={isCreating}
        className="w-full"
      >
        {isCreating ? 'Creating Agreement...' : 'Create Purchase Agreement'}
      </Button>
    </Card>
  );
}