import { statementFixture } from "./quickmanage";
// Diagnosed v8 trip identities, times and numeric shape; addresses, recipient and PDF are synthetic.
const trips = [
  {
    id: "f0669e78-3ddc-4612-9eb6-9bc7152f9207",
    trip_id: "f0669e78-3ddc-4612-9eb6-9bc7152f9207",
    trip_number: 9059,
    trip_ref_number: "115Q66F7F",
    origin_app_time: "2026-01-18T01:08:00-08:00",
    mileage: 0,
    deadhead: 0,
    rate: 120,
    net_amount: 0,
    contract_info: "Pay Per Mile $0.00/$0.00",
    origin: {
      city: "Synthetic origin",
    },
    destination: {
      city: "Synthetic destination",
    },
    statement_stops: [
      {
        id: "stop-a",
      },
      {
        id: "stop-b",
      },
    ],
  },
  {
    id: "06d7517d-53be-4701-a5b7-0a26372456d5",
    trip_id: "06d7517d-53be-4701-a5b7-0a26372456d5",
    trip_number: 9060,
    trip_ref_number: "111STMW9Z",
    origin_app_time: "2026-01-18T03:00:00-08:00",
    mileage: 0,
    deadhead: 0,
    rate: 0,
    net_amount: 0,
    contract_info: "Pay Per Mile $0.00/$0.00",
    origin: {
      city: "Synthetic origin",
    },
    destination: {
      city: "Synthetic destination",
    },
    statement_stops: [
      {
        id: "stop-a",
      },
      {
        id: "stop-b",
      },
    ],
  },
  {
    id: "98a4ebfc-d35c-4dcb-9dde-e3668245ad3f",
    trip_id: "98a4ebfc-d35c-4dcb-9dde-e3668245ad3f",
    trip_number: 9061,
    trip_ref_number: "1114DNL6H",
    origin_app_time: "2026-01-18T05:00:00-08:00",
    mileage: 23.04,
    deadhead: 26.66,
    rate: 128.52,
    net_amount: 0,
    contract_info: "Pay Per Mile $0.00/$0.00",
    origin: {
      city: "Synthetic origin",
    },
    destination: {
      city: "Synthetic destination",
    },
    statement_stops: [
      {
        id: "stop-a",
      },
      {
        id: "stop-b",
      },
    ],
  },
  {
    id: "3a583342-67ff-4454-85b0-7e07c7d5f217",
    trip_id: "3a583342-67ff-4454-85b0-7e07c7d5f217",
    trip_number: 9063,
    trip_ref_number: "115GR8WVN",
    origin_app_time: "2026-01-18T09:00:00-08:00",
    mileage: 0,
    deadhead: 0,
    rate: 0,
    net_amount: 0,
    contract_info: "Pay Per Mile $0.00/$0.00",
    origin: {
      city: "Synthetic origin",
    },
    destination: {
      city: "Synthetic destination",
    },
    statement_stops: [
      {
        id: "stop-a",
      },
      {
        id: "stop-b",
      },
    ],
  },
  {
    id: "f6c6b01b-e49a-4e91-9022-e9f807765ca6",
    trip_id: "f6c6b01b-e49a-4e91-9022-e9f807765ca6",
    trip_number: 9102,
    trip_ref_number: "1155SDKTV",
    origin_app_time: "2026-01-18T23:14:00-08:00",
    mileage: 11.64,
    deadhead: 23.38,
    rate: 124.31,
    net_amount: 0,
    contract_info: "Pay Per Mile $0.00/$0.00",
    origin: {
      city: "Synthetic origin",
    },
    destination: {
      city: "Synthetic destination",
    },
    statement_stops: [
      {
        id: "stop-a",
      },
      {
        id: "stop-b",
      },
    ],
  },
  {
    id: "2fd62dcf-b10f-444e-8e25-af6869148b48",
    trip_id: "2fd62dcf-b10f-444e-8e25-af6869148b48",
    trip_number: 9100,
    trip_ref_number: "T-112YN2BSS",
    origin_app_time: "2026-01-19T01:08:00-08:00",
    mileage: 20.43,
    deadhead: 14.78,
    rate: 167.15,
    net_amount: 0,
    contract_info: "Pay Per Mile $0.00/$0.00",
    origin: {
      city: "Synthetic origin",
    },
    destination: {
      city: "Synthetic destination",
    },
    statement_stops: [
      {
        id: "stop-a",
      },
      {
        id: "stop-b",
      },
    ],
  },
  {
    id: "216fde93-ec99-46df-8009-b7f955aa5014",
    trip_id: "216fde93-ec99-46df-8009-b7f955aa5014",
    trip_number: 9101,
    trip_ref_number: "114W1J7CD",
    origin_app_time: "2026-01-19T04:13:00-08:00",
    mileage: 35.08,
    deadhead: 37.75,
    rate: 167.55,
    net_amount: 0,
    contract_info: "Pay Per Mile $0.00/$0.00",
    origin: {
      city: "Synthetic origin",
    },
    destination: {
      city: "Synthetic destination",
    },
    statement_stops: [
      {
        id: "stop-a",
      },
      {
        id: "stop-b",
      },
    ],
  },
  {
    id: "c3f7eb1c-1f7e-427a-8c4c-50308fca3e40",
    trip_id: "c3f7eb1c-1f7e-427a-8c4c-50308fca3e40",
    trip_number: 9025,
    trip_ref_number: "114657R4T",
    origin_app_time: "2026-01-19T07:13:00-08:00",
    mileage: 14.98,
    deadhead: 24.5,
    rate: 115.95,
    net_amount: 0,
    contract_info: "Pay Per Mile $0.00/$0.00",
    origin: {
      city: "Synthetic origin",
    },
    destination: {
      city: "Synthetic destination",
    },
    statement_stops: [
      {
        id: "stop-a",
      },
      {
        id: "stop-b",
      },
    ],
  },
  {
    id: "0792598a-58e2-4397-b103-ef5d98510f4a",
    trip_id: "0792598a-58e2-4397-b103-ef5d98510f4a",
    trip_number: 9098,
    trip_ref_number: "T-111RJDH7Q",
    origin_app_time: "2026-01-19T07:13:00-08:00",
    mileage: 25.03,
    deadhead: 2.96,
    rate: 115.95,
    net_amount: 0,
    contract_info: "Pay Per Mile $0.00/$0.00",
    origin: {
      city: "Synthetic origin",
    },
    destination: {
      city: "Synthetic destination",
    },
    statement_stops: [
      {
        id: "stop-a",
      },
      {
        id: "stop-b",
      },
    ],
  },
  {
    id: "58d96962-5ed6-44e7-a7ef-4a5b8f78c502",
    trip_id: "58d96962-5ed6-44e7-a7ef-4a5b8f78c502",
    trip_number: 9026,
    trip_ref_number: "114XNMSGW",
    origin_app_time: "2026-01-19T20:08:00-08:00",
    mileage: 16.98,
    deadhead: 15.7,
    rate: 126.28,
    net_amount: 0,
    contract_info: "Pay Per Mile $0.00/$0.00",
    origin: {
      city: "Synthetic origin",
    },
    destination: {
      city: "Synthetic destination",
    },
    statement_stops: [
      {
        id: "stop-a",
      },
      {
        id: "stop-b",
      },
    ],
  },
  {
    id: "0c9d2a3c-1abd-428d-8cc2-193cc611b981",
    trip_id: "0c9d2a3c-1abd-428d-8cc2-193cc611b981",
    trip_number: 9027,
    trip_ref_number: "116JRS6S8",
    origin_app_time: "2026-01-19T22:29:00-08:00",
    mileage: 0,
    deadhead: 0,
    rate: 120,
    net_amount: 0,
    contract_info: "Pay Per Mile $0.00/$0.00",
    origin: {
      city: "Synthetic origin",
    },
    destination: {
      city: "Synthetic destination",
    },
    statement_stops: [
      {
        id: "stop-a",
      },
      {
        id: "stop-b",
      },
    ],
  },
  {
    id: "6dbb8f22-0f9f-427d-b1b5-e8092062e745",
    trip_id: "6dbb8f22-0f9f-427d-b1b5-e8092062e745",
    trip_number: 9030,
    trip_ref_number: "1123VDJTX",
    origin_app_time: "2026-01-20T00:29:00-08:00",
    mileage: 13.55,
    deadhead: 28.11,
    rate: 125.01,
    net_amount: 0,
    contract_info: "Pay Per Mile $0.00/$0.00",
    origin: {
      city: "Synthetic origin",
    },
    destination: {
      city: "Synthetic destination",
    },
    statement_stops: [
      {
        id: "stop-a",
      },
      {
        id: "stop-b",
      },
    ],
  },
  {
    id: "932868cd-971c-42f6-8d62-e9e00b7b37a7",
    trip_id: "932868cd-971c-42f6-8d62-e9e00b7b37a7",
    trip_number: 9028,
    trip_ref_number: "113YXGDM5",
    origin_app_time: "2026-01-20T00:29:00-08:00",
    mileage: 0,
    deadhead: 0,
    rate: 0,
    net_amount: 0,
    contract_info: "Pay Per Mile $0.00/$0.00",
    origin: {
      city: "Synthetic origin",
    },
    destination: {
      city: "Synthetic destination",
    },
    statement_stops: [
      {
        id: "stop-a",
      },
      {
        id: "stop-b",
      },
    ],
  },
  {
    id: "de141399-1e9d-4013-81a0-bf318a30e106",
    trip_id: "de141399-1e9d-4013-81a0-bf318a30e106",
    trip_number: 9031,
    trip_ref_number: "116TKNV79",
    origin_app_time: "2026-01-20T05:13:00-08:00",
    mileage: 22.05,
    deadhead: 32.74,
    rate: 165.61,
    net_amount: 0,
    contract_info: "Pay Per Mile $0.00/$0.00",
    origin: {
      city: "Synthetic origin",
    },
    destination: {
      city: "Synthetic destination",
    },
    statement_stops: [
      {
        id: "stop-a",
      },
      {
        id: "stop-b",
      },
    ],
  },
  {
    id: "5248333d-f7b0-49ec-9ecc-36f5502ad7b9",
    trip_id: "5248333d-f7b0-49ec-9ecc-36f5502ad7b9",
    trip_number: 9032,
    trip_ref_number: "1112KQBGN",
    origin_app_time: "2026-01-20T19:29:00-08:00",
    mileage: 32.18,
    deadhead: 36.56,
    rate: 131.91,
    net_amount: 0,
    contract_info: "Pay Per Mile $0.00/$0.00",
    origin: {
      city: "Synthetic origin",
    },
    destination: {
      city: "Synthetic destination",
    },
    statement_stops: [
      {
        id: "stop-a",
      },
      {
        id: "stop-b",
      },
    ],
  },
  {
    id: "30453d0c-7651-4396-8a05-e10b6c3a81fd",
    trip_id: "30453d0c-7651-4396-8a05-e10b6c3a81fd",
    trip_number: 9033,
    trip_ref_number: "111HY4TJM",
    origin_app_time: "2026-01-20T22:29:00-08:00",
    mileage: 6.28,
    deadhead: 29.36,
    rate: 122.32,
    net_amount: 0,
    contract_info: "Pay Per Mile $0.00/$0.00",
    origin: {
      city: "Synthetic origin",
    },
    destination: {
      city: "Synthetic destination",
    },
    statement_stops: [
      {
        id: "stop-a",
      },
      {
        id: "stop-b",
      },
    ],
  },
  {
    id: "a89668d6-e002-4630-b16a-79e55dee1ffc",
    trip_id: "a89668d6-e002-4630-b16a-79e55dee1ffc",
    trip_number: 9034,
    trip_ref_number: "1125WKHHH",
    origin_app_time: "2026-01-21T20:08:00-08:00",
    mileage: 1.4,
    deadhead: 20.7,
    rate: 120.52,
    net_amount: 0,
    contract_info: "Pay Per Mile $0.00/$0.00",
    origin: {
      city: "Synthetic origin",
    },
    destination: {
      city: "Synthetic destination",
    },
    statement_stops: [
      {
        id: "stop-a",
      },
      {
        id: "stop-b",
      },
    ],
  },
  {
    id: "6fd8d8b1-5721-469a-b5d5-4fa9d5b4b01d",
    trip_id: "6fd8d8b1-5721-469a-b5d5-4fa9d5b4b01d",
    trip_number: 9035,
    trip_ref_number: "1143G4PYL",
    origin_app_time: "2026-01-21T21:59:00-08:00",
    mileage: 4.78,
    deadhead: 5.22,
    rate: 121.77,
    net_amount: 0,
    contract_info: "Pay Per Mile $0.00/$0.00",
    origin: {
      city: "Synthetic origin",
    },
    destination: {
      city: "Synthetic destination",
    },
    statement_stops: [
      {
        id: "stop-a",
      },
      {
        id: "stop-b",
      },
    ],
  },
  {
    id: "cd42378c-29ab-4124-90d0-394a52782b4b",
    trip_id: "cd42378c-29ab-4124-90d0-394a52782b4b",
    trip_number: 9072,
    trip_ref_number: "11295BB4N",
    origin_app_time: "2026-01-22T02:08:00-08:00",
    mileage: 11.05,
    deadhead: 16.04,
    rate: 119.2,
    net_amount: 0,
    contract_info: "Pay Per Mile $0.00/$0.00",
    origin: {
      city: "Synthetic origin",
    },
    destination: {
      city: "Synthetic destination",
    },
    statement_stops: [
      {
        id: "stop-a",
      },
      {
        id: "stop-b",
      },
    ],
  },
  {
    id: "743b0bbd-bd44-48c7-bf76-031004e01372",
    trip_id: "743b0bbd-bd44-48c7-bf76-031004e01372",
    trip_number: 9071,
    trip_ref_number: "113RJ1PNL",
    origin_app_time: "2026-01-22T06:30:00-08:00",
    mileage: 11.05,
    deadhead: 16.04,
    rate: 119.2,
    net_amount: 0,
    contract_info: "Pay Per Mile $0.00/$0.00",
    origin: {
      city: "Synthetic origin",
    },
    destination: {
      city: "Synthetic destination",
    },
    statement_stops: [
      {
        id: "stop-a",
      },
      {
        id: "stop-b",
      },
    ],
  },
  {
    id: "73c7e725-f858-4d4d-aa28-f15ecb258ad4",
    trip_id: "73c7e725-f858-4d4d-aa28-f15ecb258ad4",
    trip_number: 9037,
    trip_ref_number: "1133HRSZ6",
    origin_app_time: "2026-01-22T20:13:00-08:00",
    mileage: 26.25,
    deadhead: 18.2,
    rate: 129.97,
    net_amount: 0,
    contract_info: "Pay Per Mile $0.00/$0.00",
    origin: {
      city: "Synthetic origin",
    },
    destination: {
      city: "Synthetic destination",
    },
    statement_stops: [
      {
        id: "stop-a",
      },
      {
        id: "stop-b",
      },
    ],
  },
  {
    id: "1e7e6191-0816-42cd-a101-f6f8faafd694",
    trip_id: "1e7e6191-0816-42cd-a101-f6f8faafd694",
    trip_number: 9040,
    trip_ref_number: "11588VHZC",
    origin_app_time: "2026-01-22T22:59:00-08:00",
    mileage: 10.73,
    deadhead: 25.12,
    rate: 124.08,
    net_amount: 0,
    contract_info: "Pay Per Mile $0.00/$0.00",
    origin: {
      city: "Synthetic origin",
    },
    destination: {
      city: "Synthetic destination",
    },
    statement_stops: [
      {
        id: "stop-a",
      },
      {
        id: "stop-b",
      },
    ],
  },
  {
    id: "6ff8578b-3c1d-4463-bb35-66017fc2c502",
    trip_id: "6ff8578b-3c1d-4463-bb35-66017fc2c502",
    trip_number: 9041,
    trip_ref_number: "115RKR14Z",
    origin_app_time: "2026-01-23T01:00:00-08:00",
    mileage: 4.38,
    deadhead: 52.49,
    rate: 116.66,
    net_amount: 0,
    contract_info: "Pay Per Mile $0.00/$0.00",
    origin: {
      city: "Synthetic origin",
    },
    destination: {
      city: "Synthetic destination",
    },
    statement_stops: [
      {
        id: "stop-a",
      },
      {
        id: "stop-b",
      },
    ],
  },
  {
    id: "5df06b7c-c2ac-48e0-a8a0-43747648cc1c",
    trip_id: "5df06b7c-c2ac-48e0-a8a0-43747648cc1c",
    trip_number: 9042,
    trip_ref_number: "115Q1PZJ3",
    origin_app_time: "2026-01-23T06:48:00-08:00",
    mileage: 26.18,
    deadhead: 50.54,
    rate: 124.95,
    net_amount: 0,
    contract_info: "Pay Per Mile $0.00/$0.00",
    origin: {
      city: "Synthetic origin",
    },
    destination: {
      city: "Synthetic destination",
    },
    statement_stops: [
      {
        id: "stop-a",
      },
      {
        id: "stop-b",
      },
    ],
  },
  {
    id: "6ee2c621-3506-4cd9-ad6c-bcddd38fab6a",
    trip_id: "6ee2c621-3506-4cd9-ad6c-bcddd38fab6a",
    trip_number: 9073,
    trip_ref_number: "112D8LHR7",
    origin_app_time: "2026-01-23T17:15:00-08:00",
    mileage: 32.18,
    deadhead: 42.46,
    rate: 132.23,
    net_amount: 0,
    contract_info: "Pay Per Mile $0.00/$0.00",
    origin: {
      city: "Synthetic origin",
    },
    destination: {
      city: "Synthetic destination",
    },
    statement_stops: [
      {
        id: "stop-a",
      },
      {
        id: "stop-b",
      },
    ],
  },
  {
    id: "9848a27d-60fa-44c7-9f73-f2845fc34f66",
    trip_id: "9848a27d-60fa-44c7-9f73-f2845fc34f66",
    trip_number: 9074,
    trip_ref_number: "1132JSHZJ",
    origin_app_time: "2026-01-23T22:30:00-08:00",
    mileage: 35.29,
    deadhead: 37.75,
    rate: 128.41,
    net_amount: 0,
    contract_info: "Pay Per Mile $0.00/$0.00",
    origin: {
      city: "Synthetic origin",
    },
    destination: {
      city: "Synthetic destination",
    },
    statement_stops: [
      {
        id: "stop-a",
      },
      {
        id: "stop-b",
      },
    ],
  },
  {
    id: "e1ca13c0-1dbf-4f83-8ac7-7168f0782137",
    trip_id: "e1ca13c0-1dbf-4f83-8ac7-7168f0782137",
    trip_number: 9075,
    trip_ref_number: "1165NH6XC",
    origin_app_time: "2026-01-24T00:00:00-08:00",
    mileage: 0,
    deadhead: 0,
    rate: 171.28,
    net_amount: 0,
    contract_info: "Pay Per Mile $0.00/$0.00",
    origin: {
      city: "Synthetic origin",
    },
    destination: {
      city: "Synthetic destination",
    },
    statement_stops: [
      {
        id: "stop-a",
      },
      {
        id: "stop-b",
      },
    ],
  },
];
export function tripTiesFixture() {
  const fixture = statementFixture({
    id: "07adb439-f70a-4c14-b7c7-52314daa9c7b",
    version: 8,
    pid: "2026-04",
    terminated: true,
  });
  const payload = {
    ...fixture.payload,
    data: {
      ...fixture.payload.data,
      fixed_pays: [],
      trips: structuredClone(trips).map((trip) => ({
        ...trip,
        id: trip.id as (typeof fixture.payload.data.trips)[number]["id"],
        excluded: false,
        unit_id: "8558",
      })),
    },
  };
  return {
    ...fixture,
    payload,
    bundle: { ...fixture.bundle, detail: Buffer.from(JSON.stringify(payload)) },
  };
}
export function swapTripTies(rows: typeof trips, first = true, second = true) {
  if (first) [rows[7], rows[8]] = [rows[8], rows[7]];
  if (second) [rows[11], rows[12]] = [rows[12], rows[11]];
}
