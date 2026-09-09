import { describe, expect, it } from 'vitest';
import { functionsOverlapping, parseGo } from '../src/go.js';

const source = `package tenant

import (
	"context"
	"fmt"

	pb "example.test/api/tenantpb"
)

type Service struct{ store Store }

func (s *Service) UpdateRecord(ctx context.Context, req *pb.UpdateRecordRequest) (*pb.Record, error) {
	if req.GetId() == "" || ctx == nil {
		return nil, fmt.Errorf("id is required")
	}
	record, err := s.store.Load(ctx, req.GetId())
	if err != nil {
		return nil, err
	}
	switch record.State {
	case 1:
		record.State = 2
	case 2:
	}
	for _, tag := range req.Tags {
		if tag == "" {
			return nil, fmt.Errorf("empty tag")
		}
	}
	return record, nil
}

func helper() int {
	return 1
}
`;

describe('parseGo', () => {
  it('names methods Type.Method and functions by their bare name', async () => {
    const file = await parseGo(source);
    expect(file.packageName).toBe('tenant');
    expect(file.functions.map((f) => f.name)).toEqual(['Service.UpdateRecord', 'helper']);
    expect(file.functions[0]?.receiverType).toBe('Service');
    expect(file.functions[0]?.exported).toBe(true);
    expect(file.functions[1]?.exported).toBe(false);
  });

  it('reads the import block', async () => {
    const file = await parseGo(source);
    expect(file.imports).toEqual([
      { alias: 'context', path: 'context' },
      { alias: 'fmt', path: 'fmt' },
      { alias: 'pb', path: 'example.test/api/tenantpb' },
    ]);
  });

  it('counts complexity from branches, short circuits and guarded returns', async () => {
    const file = await parseGo(source);
    // 1 base + 3 if + 1 || + 2 case + 1 for + 3 returns inside a branch.
    expect(file.functions[0]?.complexity).toBe(11);
    expect(file.functions[1]?.complexity).toBe(1);
  });

  it('records call sites with the receiver expression', async () => {
    const file = await parseGo(source);
    const calls = file.functions[0]?.calls ?? [];
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Load', receiver: 's.store' }),
        expect.objectContaining({ name: 'GetId', receiver: 'req' }),
        expect.objectContaining({ name: 'Errorf', receiver: 'fmt' }),
      ]),
    );
  });

  it('types the receiver and the parameters', async () => {
    const file = await parseGo(source);
    expect(file.functions[0]?.localTypes).toMatchObject({
      s: 'Service',
      ctx: 'context.Context',
      req: 'pb.UpdateRecordRequest',
    });
  });

  it('finds the functions a hunk overlaps', async () => {
    const file = await parseGo(source);
    expect(functionsOverlapping(file.functions, [[16, 20]]).map((f) => f.name)).toEqual([
      'Service.UpdateRecord',
    ]);
    expect(functionsOverlapping(file.functions, [[34, 36]]).map((f) => f.name)).toEqual(['helper']);
    expect(functionsOverlapping(file.functions, [[1, 3]])).toEqual([]);
  });

  it('survives a file it cannot parse cleanly', async () => {
    const file = await parseGo('package broken\n\nfunc (\n');
    expect(file.packageName).toBe('broken');
  });
});
