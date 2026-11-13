import React from 'react';
import test from 'node:test';
import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import DriverPerformancePreparation from '@/components/fleet/DriverPerformancePreparation';

test('retained preparation lists requested business definitions without invented records or scores',()=>{
 const html=renderToStaticMarkup(<DriverPerformancePreparation/>);
 for(const label of ['Driver profitability &amp; performance','Weekly gross revenue','Driver compensation earned','Actual payments excluding advances','Advances paid','Approved time off','Unplanned absences','Required rest','On-time pickups','On-time deliveries','Timely dispatcher updates','Verified fuel consumed','Contribution profit','Contribution per mile','Gross per worked day','Overall driver score','Week and operational timezone'])
  assert.ok(html.includes(label),label);
 assert.match(html,/Not calculated/);assert.match(html,/Not connected/);assert.match(html,/No driver ranking/);
 assert.doesNotMatch(html,/\$0|100\/100|0%|Score: 0/);
});
