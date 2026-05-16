import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReceiverSettingsPage } from './receiver-settings.page';
import { PreferencesService } from '../../core/storage/preferences.service';
import { WebRTCService } from '../../core/webrtc/webrtc.service';

describe('ReceiverSettingsPage', () => {
	let component: ReceiverSettingsPage;
	let fixture: ComponentFixture<ReceiverSettingsPage>;
	let mockPreferences: jasmine.SpyObj<PreferencesService>;
	let mockWebRTC: jasmine.SpyObj<WebRTCService>;

	beforeEach(async () => {
		mockPreferences = jasmine.createSpyObj('PreferencesService', [
			'getVuMeterSensitivity',
			'setVuMeterSensitivity',
			'getKeepScreenOn',
			'setKeepScreenOn',
			'getRemoteNoiseCancellation',
			'setRemoteNoiseCancellation',
			'getRemoteEchoCancellation',
			'setRemoteEchoCancellation',
			'getRemoteAutoGainControl',
			'setRemoteAutoGainControl',
		]);
		mockWebRTC = jasmine.createSpyObj('WebRTCService', ['sendDataChannelMessage']);

		mockPreferences.getVuMeterSensitivity.and.returnValue('medium');
		mockPreferences.getKeepScreenOn.and.returnValue(false);
		mockPreferences.getRemoteNoiseCancellation.and.returnValue(false);
		mockPreferences.getRemoteEchoCancellation.and.returnValue(false);
		mockPreferences.getRemoteAutoGainControl.and.returnValue(false);

		await TestBed.configureTestingModule({
			imports: [ReceiverSettingsPage],
			providers: [
				{ provide: PreferencesService, useValue: mockPreferences },
				{ provide: WebRTCService, useValue: mockWebRTC },
			],
		}).compileComponents();

		fixture = TestBed.createComponent(ReceiverSettingsPage);
		component = fixture.componentInstance;
		fixture.detectChanges();
	});

	it('should create', () => {
		expect(component).toBeTruthy();
	});

	it('should load remote mic settings from preferences', () => {
		expect(mockPreferences.getRemoteNoiseCancellation).toHaveBeenCalled();
		expect(mockPreferences.getRemoteEchoCancellation).toHaveBeenCalled();
		expect(mockPreferences.getRemoteAutoGainControl).toHaveBeenCalled();
	});

	describe('onNoiseCancellationChange', () => {
		it('should update preference and send data channel message', () => {
			const event = { detail: { checked: true } } as CustomEvent;
			component.onNoiseCancellationChange(event);
			expect(mockPreferences.setRemoteNoiseCancellation).toHaveBeenCalledWith(true);
			expect(mockWebRTC.sendDataChannelMessage).toHaveBeenCalledWith({
				type: 'micSettings',
				payload: {
					noiseCancellation: true,
					echoCancellation: false,
					autoGainControl: false,
				},
			});
		});
	});

	describe('onEchoCancellationChange', () => {
		it('should update preference and send data channel message', () => {
			const event = { detail: { checked: true } } as CustomEvent;
			component.onEchoCancellationChange(event);
			expect(mockPreferences.setRemoteEchoCancellation).toHaveBeenCalledWith(true);
			expect(mockWebRTC.sendDataChannelMessage).toHaveBeenCalledWith({
				type: 'micSettings',
				payload: {
					noiseCancellation: false,
					echoCancellation: true,
					autoGainControl: false,
				},
			});
		});
	});

	describe('onAutoGainControlChange', () => {
		it('should update preference and send data channel message', () => {
			const event = { detail: { checked: true } } as CustomEvent;
			component.onAutoGainControlChange(event);
			expect(mockPreferences.setRemoteAutoGainControl).toHaveBeenCalledWith(true);
			expect(mockWebRTC.sendDataChannelMessage).toHaveBeenCalledWith({
				type: 'micSettings',
				payload: {
					noiseCancellation: false,
					echoCancellation: false,
					autoGainControl: true,
				},
			});
		});
	});
});
