/** Vehicle work uses the same work-order reader and reviewed Sign flow as the vehicle profile. */
import React from 'react';
import { useParams } from 'react-router-dom';
import { PrefetchLink } from '../components/PrefetchLink';
import { useAuth } from '../hooks/useAuth';
import { usePageTitle } from '../hooks/usePageTitle';
import { Text } from '../kit';
import VehicleWorkCard from './jobs/VehicleWorkCard';
import './jobs/jobs.css';

export default function VehicleJobs() {
  const { vehicleId } = useParams<{ vehicleId: string }>();
  const { user } = useAuth();
  usePageTitle('Vehicle work');
  return <article className="jb-page jb-scope">
    <div className="jb-intro"><Text role="entity" as="h1">Vehicle work</Text>
      <Text role="body">Review the work orders, plan the work, or post a request for this vehicle.</Text>
    </div>
    {!vehicleId ? <p role="alert">A vehicle is required to open its work.</p> : <>
      <nav className="jb-actions" aria-label="Vehicle work navigation">
        <PrefetchLink to={`/vehicle/${vehicleId}`}>Back to vehicle</PrefetchLink>
        <PrefetchLink to={`/vehicle/${vehicleId}/mailbox`}>Open mailbox</PrefetchLink>
      </nav>
      <VehicleWorkCard vehicleId={vehicleId} vehicleTitle="This vehicle" signedIn={!!user} />
    </>}
  </article>;
}
