jest.mock('@gitroom/helpers/utils/read.or.fetch', () => ({
  readOrFetch: jest.fn(),
}));

jest.mock('sharp', () => ({
  __esModule: true,
  default: jest.fn(),
}));

import { XProvider } from './x.provider';
import { readOrFetch } from '@gitroom/helpers/utils/read.or.fetch';
import sharp from 'sharp';

const mockedReadOrFetch = readOrFetch as jest.MockedFunction<typeof readOrFetch>;
const mockedSharp = sharp as unknown as jest.Mock;

describe('XProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedReadOrFetch.mockResolvedValue(Buffer.from('media'));
  });

  describe('uploadMediaFile', () => {
    it('uses the V1 upload path for video media', async () => {
      const provider = new XProvider();
      const client = {
        v1: { uploadMedia: jest.fn().mockResolvedValue('video-id') },
        v2: { uploadMedia: jest.fn() },
      } as any;

      await expect(
        (provider as any).uploadMediaFile(client, 'https://example.com/video.mp4')
      ).resolves.toBe('video-id');

      expect(client.v1.uploadMedia).toHaveBeenCalledWith(
        expect.any(Buffer),
        { mimeType: 'video/mp4' }
      );
      expect(client.v2.uploadMedia).not.toHaveBeenCalled();
    });

    it('keeps image media on the V2 path', async () => {
      const provider = new XProvider();
      const toBuffer = jest.fn().mockResolvedValue(Buffer.from('gif'));
      mockedSharp.mockReturnValue({
        resize: () => ({
          gif: () => ({ toBuffer }),
        }),
      });
      const client = {
        v1: { uploadMedia: jest.fn() },
        v2: { uploadMedia: jest.fn().mockResolvedValue('image-id') },
      } as any;

      await expect(
        (provider as any).uploadMediaFile(client, 'https://example.com/image.png')
      ).resolves.toBe('image-id');

      expect(client.v1.uploadMedia).not.toHaveBeenCalled();
      expect(client.v2.uploadMedia).toHaveBeenCalledWith(
        expect.any(Buffer),
        { media_type: 'image/png' }
      );
    });
  });

  describe('handleErrors', () => {
    it('preserves the provider status and message for upload failures', () => {
      const provider = new XProvider();

      expect(
        provider.handleErrors(
          JSON.stringify({
            code: 400,
            detail: 'The media type is not supported',
          })
        )
      ).toEqual({
        type: 'bad-body',
        value: 'X rejected the request (HTTP 400): The media type is not supported',
      });
    });

    it('does not expose an opaque provider error as a successful result', () => {
      const provider = new XProvider();

      expect(provider.handleErrors(JSON.stringify({ code: 400 }))).toEqual({
        type: 'bad-body',
        value: 'X rejected the request (HTTP 400)',
      });
    });
  });
});
