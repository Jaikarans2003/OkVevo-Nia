/**
 * Pet tab is internal-only. Public builds keep Bot / Generate / Upload.
 */

import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const isByokChromeVisible = vi.hoisted(() => vi.fn(() => true))

vi.mock('@/lib/build-channel', () => ({
  isByokChromeVisible
}))

vi.mock('@hermes/plugin-sdk', () => ({
  Button: (props: React.ComponentProps<'button'>) => <button {...props} />,
  cn: (...parts: unknown[]) => parts.filter(Boolean).join(' '),
  Codicon: () => null,
  ColorSwatches: () => null,
  GlyphSpinner: () => null,
  host: { notifyError: vi.fn(), request: vi.fn() },
  PROFILE_SWATCHES: [],
  RowButton: (props: React.ComponentProps<'button'>) => <button {...props} />,
  SegmentedControl: ({
    options,
    value
  }: {
    options: Array<{ id: string; label: string }>
    value: string
  }) => (
    <div data-testid="avatar-tabs" data-value={value}>
      {options.map(option => (
        <button data-tab={option.id} key={option.id} type="button">
          {option.label}
        </button>
      ))}
    </div>
  ),
  Textarea: (props: React.ComponentProps<'textarea'>) => <textarea {...props} />,
  useValue: () => false
}))

vi.mock('./avatar', () => ({
  AVATAR_PICKER_SHAPES: [],
  avatarColor: () => '#000',
  BLOB_KINDS: [],
  blobatarSvg: null,
  blobShapeString: () => '',
  BotFace: () => null,
  defaultShapeFor: () => 'circle',
  isBlobShape: () => false,
  parseBlobShape: () => ({ kind: '', seedPart: '' })
}))

vi.mock('./avatar-image', () => ({
  $imagenAvailable: { get: () => false, set: vi.fn() },
  generateAvatarImage: vi.fn(),
  normalizeAvatarImage: vi.fn(),
  pickImageFromDevice: vi.fn(),
  probeImagen: vi.fn()
}))

vi.mock('./i18n', () => ({
  useBots: () => ({
    avatar: {
      blobFromName: '',
      classicShapes: '',
      describeHint: '',
      describePlaceholder: '',
      generationFailed: '',
      matchTheName: '',
      randomize: '',
      removeImage: 'Remove',
      tabBot: 'Bot',
      tabGenerate: 'Generate',
      tabPet: 'Pet',
      unlockFollowsName: '',
      upload: 'Upload'
    },
    bot: { descriptionHint: '' }
  })
}))

vi.mock('./pet', () => ({
  PetTab: () => <div data-testid="pet-tab" />
}))

import { AvatarPicker } from './avatar-picker'

function mount() {
  return render(
    <AvatarPicker color={null} image={null} onColor={vi.fn()} onImage={vi.fn()} onShape={vi.fn()} shape="circle" />
  )
}

beforeEach(() => {
  isByokChromeVisible.mockReturnValue(true)
})

describe('AvatarPicker pet tab channel', () => {
  it('keeps Pet on internal builds', () => {
    isByokChromeVisible.mockReturnValue(true)
    const { getByText, queryByTestId } = mount()

    expect(getByText('Bot')).toBeTruthy()
    expect(getByText('Generate')).toBeTruthy()
    expect(getByText('Upload')).toBeTruthy()
    expect(getByText('Pet')).toBeTruthy()
    expect(queryByTestId('pet-tab')).toBeNull()
  })

  it('omits Pet on public builds', () => {
    isByokChromeVisible.mockReturnValue(false)
    const { getByText, queryByText, queryByTestId } = mount()

    expect(getByText('Bot')).toBeTruthy()
    expect(getByText('Generate')).toBeTruthy()
    expect(getByText('Upload')).toBeTruthy()
    expect(queryByText('Pet')).toBeNull()
    expect(queryByTestId('pet-tab')).toBeNull()
  })
})
