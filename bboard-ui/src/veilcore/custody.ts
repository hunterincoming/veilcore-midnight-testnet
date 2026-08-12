// Where a sample actually is, and what has come back.
//
// Real lab workflow is three events, not one. The submitter signs a chain-of-custody
// form before the sample leaves. The lab confirms receipt. Days later — typically five
// to ten business days — the lab returns a report. Collapsing those into a single
// "attested" flag hides the week where a breeder is waiting and does not know whether
// their sample arrived.
//
// The app previously had the breeder pair a DNA report themselves, which inverts
// reality: the lab produces the report, so the breeder cannot have one until the lab
// sends it back.
//
// SPDX-License-Identifier: Apache-2.0

import type { StrainRecord } from './records';
import type { ResolvedAttestation } from './attesters';

export type CustodyStage =
  | 'held'          // with the breeder, nothing sent
  | 'in-transit'    // sent, not yet confirmed received
  | 'received'      // lab confirmed receipt, testing
  | 'reported';     // report returned

export type CustodyState = {
  stage: CustodyStage;
  /** What the breeder should understand right now. */
  headline: string;
  detail: string;
  /** Who is holding the next action. */
  waitingOn: 'you' | 'the lab' | 'nobody';
};

export const custodyOf = (
  record: StrainRecord,
  attestations: ResolvedAttestation[],
  hasOpenTransfer: boolean,
): CustodyState => {
  const live = attestations.filter((a) => !a.retraction && a.signatureValid);
  const report = live.find((a) => a.type === 'laboratory-report' || a.type === 'genetic-fingerprint');
  const receipt = live.find((a) => a.type === 'chain-of-custody');

  if (report) {
    return {
      stage: 'reported',
      headline: 'Report returned',
      detail: `${report.registeredAs?.displayName ?? 'The lab'} returned a report and signed it. Your record now carries evidence produced by someone other than you.`,
      waitingOn: 'nobody',
    };
  }

  if (receipt) {
    return {
      stage: 'received',
      headline: 'Received by the lab',
      detail: `${receipt.registeredAs?.displayName ?? 'The lab'} confirmed they received the sample on ${new Date(receipt.issuedAt).toLocaleDateString()}. Results typically take five to ten business days.`,
      waitingOn: 'the lab',
    };
  }

  if (hasOpenTransfer) {
    return {
      stage: 'in-transit',
      headline: 'Sent, awaiting confirmation',
      detail: 'You have given a transfer code to the recipient. Nothing changes until they confirm receipt — until then the sample is in transit as far as this record is concerned.',
      waitingOn: 'the lab',
    };
  }

  return {
    stage: 'held',
    headline: 'Held by you',
    detail: 'This record is your own account of the cultivar. Sending a sample to a lab is what turns it into evidence a third party can rely on.',
    waitingOn: 'you',
  };
};
