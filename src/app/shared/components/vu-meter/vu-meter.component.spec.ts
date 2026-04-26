import { ComponentFixture, TestBed } from '@angular/core/testing';
import { VuMeterComponent } from './vu-meter.component';

describe('VuMeterComponent', () => {
  let component: VuMeterComponent;
  let fixture: ComponentFixture<VuMeterComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [VuMeterComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(VuMeterComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should not throw when stream is null', () => {
    fixture.componentRef.setInput('stream', null);
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });
});
