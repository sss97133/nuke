import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthContext } from '../../contexts/AuthContext';
import { readWorkSessionContext } from './workSessionEvidenceReader';
import { openVehiclePhoto } from './VehiclePhotoLightbox';
import './work-session-context.css';

/** In-place operation/evidence drill. Purchase matching and valuation remain separate. */
type Props = { vehicleId: string; sessionId: string; date: string };
function WorkContextRead({ vehicleId, sessionId, date }: Props) {
  const { user } = useAuthContext();
  const read = useQuery({ queryKey: ['work-session-context', user?.id, vehicleId, sessionId, date],
    queryFn: () => readWorkSessionContext(vehicleId, sessionId, date), enabled: !!user,
    staleTime: 0, gcTime: 0, retry: false });
  return <>
      {read.isFetching && <p role="status">Reading work evidence…</p>}
      {read.isError && <div role="status"><p>Work evidence could not load.</p><button type="button" onClick={() => void read.refetch()}>Retry work evidence</button></div>}
      {read.data && !read.isError && !read.isFetching && <>
        <p>Retained image analysis{read.data.model ? ` · ${read.data.model}` : ''}. Descriptions may need correction; they do not confirm installed quantities or labor value.</p>
        {read.data.analyzedAt && Number.isFinite(Date.parse(read.data.analyzedAt)) && <p>Analysis recorded <time dateTime={read.data.analyzedAt}>{new Date(read.data.analyzedAt).toLocaleString()}</time></p>}
        {read.data.operations.map((operation, index) => {
          const photos = operation.imageIds.flatMap(id => {
            const photo = read.data!.photos.find(photo => photo.id === id);
            return photo ? [photo] : [];
          });
          const unavailable = operation.imageIds.length - photos.length;
          return <section key={index} aria-label={operation.task}>
            <p>Image-analysis claim{operation.valueStatus ? ` · value ${operation.valueStatus}` : ' · value not established'}</p>
            <h4>{operation.task}</h4>
            {operation.component && <p>{operation.component}</p>}
            {operation.signal && <p>Analysis: {operation.signal.replace(/_/g, ' ')}</p>}
            <dl>{operation.before && <><dt>Analysis — before</dt><dd>{operation.before}</dd></>}
              {operation.after && <><dt>Analysis — after</dt><dd>{operation.after}</dd></>}</dl>
            {photos.length > 0 && <div className="vp-work-context-photos">{photos.map(photo => <button type="button" key={photo.id}
              aria-label={`Open evidence for ${operation.task}`} onClick={() => openVehiclePhoto(photo.id)}>
              <img src={photo.image_url} alt="Cited work evidence" width={120} height={120} loading="lazy" />
            </button>)}</div>}
            {unavailable > 0 && <p>{unavailable} cited {unavailable === 1 ? 'photo is' : 'photos are'} unavailable in the current session read.</p>}
            {!operation.imageIds.length && <p>No individual photo citation was retained for this step.</p>}
          </section>;
        })}
        {!read.data.operations.length && <p>No structured work steps were retained for this session.</p>}
        {read.data.photosUnavailable && <p role="status">Some cited photos could not load. Available evidence remains shown.</p>}
      </>}
  </>;
}

export default function WorkSessionContext(props: Props) {
  const { user } = useAuthContext();
  const [open, setOpen] = useState(false);
  return <details className="vp-work-context" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Work steps and evidence</summary>
    {open && (user ? <WorkContextRead key={user.id} {...props} /> : <p>Sign in to read the work evidence available to you.</p>)}
  </details>;
}
