import { arr, num, obj, str, type JsonObject } from '../jobs/jobRead';

export type OwnerState = { text: string; owners: string[]; members: string[] };

/** Who runs it on Nuke, from facility_read members (relation 'owner' or 'member', public handles) and the private count. */
export function ownerState(read: JsonObject | null): OwnerState {
  const people = arr(read?.members).map(obj).filter((m): m is JsonObject => !!m && !!str(m.handle));
  const owners = people.filter(m => m.relation === 'owner').map(m => str(m.handle)!);
  const members = people.filter(m => m.relation !== 'owner').map(m => str(m.handle)!);
  const unnamed = num(read?.members_unnamed) ?? 0;
  let text: string;
  const label = str(obj(read?.on_nuke)?.label);
  if (label && !owners.length) text = obj(read?.on_nuke)?.state === 'not_on_nuke_yet' ? `${label}: no one runs this business on Nuke` : label;
  else if (owners.length) text = `Run on Nuke by ${owners.map(h => '@' + h).join(', ')}`;
  else if (members.length || unnamed) text = `No public owner on Nuke; ${members.length + unnamed} member${members.length + unnamed === 1 ? '' : 's'}`;
  else text = 'No one runs this business on Nuke yet';
  return { text, owners, members };
}

