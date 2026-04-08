export function generateDemoRuns() {
  const now = Date.now();
  const runs = [];

  const athletes = ["Usain Bolt", "Yohan Blake", "Tyson Gay", "Asafa Powell"];
  const baseTimes = [
    [1.89, 2.88, 3.78, 4.64],
    [1.95, 2.95, 3.85, 4.75],
    [1.85, 2.82, 3.75, 4.60],
    [2.00, 3.05, 4.00, 4.90]
  ];

  for (let i = 0; i < 4; i++) {
    const exportedAtIso = new Date(now - (3 - i) * 86400000).toISOString(); // 1 day apart
    const times = baseTimes[i];
    const latestLapResults = [
      {
        id: `demo-${i}-split-1`,
        roleLabel: "Split 1",
        senderDeviceName: "Camera 1",
        distanceMeters: 10,
        elapsedNanos: times[0] * 1_000_000_000,
        lapElapsedNanos: times[0] * 1_000_000_000,
        lapSpeedMps: 10 / times[0]
      },
      {
        id: `demo-${i}-split-2`,
        roleLabel: "Split 2",
        senderDeviceName: "Camera 2",
        distanceMeters: 20,
        elapsedNanos: times[1] * 1_000_000_000,
        lapElapsedNanos: (times[1] - times[0]) * 1_000_000_000,
        lapSpeedMps: 10 / (times[1] - times[0])
      },
      {
        id: `demo-${i}-split-3`,
        roleLabel: "Split 3",
        senderDeviceName: "Camera 3",
        distanceMeters: 30,
        elapsedNanos: times[2] * 1_000_000_000,
        lapElapsedNanos: (times[2] - times[1]) * 1_000_000_000,
        lapSpeedMps: 10 / (times[2] - times[1])
      },
      {
        id: `demo-${i}-stop`,
        roleLabel: "Stop",
        senderDeviceName: "Finish Camera",
        distanceMeters: 40,
        elapsedNanos: times[3] * 1_000_000_000,
        lapElapsedNanos: (times[3] - times[2]) * 1_000_000_000,
        lapSpeedMps: 10 / (times[3] - times[2])
      }
    ];

    runs.push({
      fileName: `demo_run_${i}.json`,
      resultName: `${athletes[i]} 40m Dash`,
      athleteName: athletes[i],
      notes: "Demo run data",
      exportedAtIso,
      runId: `demo-run-${i}`,
      latestLapResults
    });
  }

  return runs;
}
