import {
  Directive,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  Output,
} from '@angular/core';
import { Dragger } from 'app/scripts/dragger';
import { Animation } from 'app/scripts/model/timeline';
import { ShortcutService } from 'app/services';
import * as $ from 'jquery';
import * as _ from 'lodash';

import { TIMELINE_ANIMATION_PADDING } from './constants';

const GRID_INTERVALS_MS = [
  10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000,
];

@Directive({ selector: '[appLayerTimelineGrid]' })
export class LayerTimelineGridDirective {

  @Input() isHeader: boolean;
  @Output() scrub = new EventEmitter<ScrubEvent>();

  private readonly canvas: HTMLCanvasElement;
  private readonly $canvas: JQuery;
  private animation_: Animation;
  private currentTime_: number;
  private horizZoom_: number;

  constructor(elementRef: ElementRef) {
    this.canvas = elementRef.nativeElement;
    this.$canvas = $(this.canvas);
  }

  get horizZoom() {
    return this.horizZoom_;
  }

  @Input()
  set horizZoom(horizZoom: number) {
    if (this.horizZoom_ !== horizZoom) {
      this.horizZoom_ = horizZoom;
      this.redraw();
    }
  }

  get currentTime() {
    return this.currentTime_;
  }

  set currentTime(currentTime: number) {
    if (this.currentTime_ !== currentTime) {
      this.currentTime_ = currentTime;
      this.redraw();
    }
  }

  get animation() {
    return this.animation_;
  }

  @Input()
  set animation(animation: Animation) {
    this.animation_ = animation;
    this.redraw();
  }

  @HostListener('mousedown', ['$event'])
  onMouseDown(event: MouseEvent) {
    this.handleScrubEvent(
      event.clientX, ShortcutService.getOsDependentModifierKey(event));
    // tslint:disable-next-line: no-unused-expression
    new Dragger({
      direction: 'horizontal',
      downX: event.clientX,
      downY: event.clientY,
      shouldSkipSlopCheck: true,
      onDragFn: e => this.handleScrubEvent(e.clientX, ShortcutService.getOsDependentModifierKey(e)),
    });
    event.preventDefault();
    return false;
  }

  private handleScrubEvent(clientX: number, disableSnap: boolean) {
    const x = clientX - this.$canvas.offset().left;
    let time = (x - TIMELINE_ANIMATION_PADDING)
      / (this.$canvas.width() - TIMELINE_ANIMATION_PADDING * 2)
      * this.animation.duration;
    time = _.clamp(time, 0, this.animation.duration);
    this.scrub.emit({ time, disableSnap });
  }

  private redraw() {
    if (!this.$canvas.is(':visible')) {
      return;
    }

    const width = this.$canvas.width();
    const height = this.$canvas.height();
    this.$canvas.attr('width', width * window.devicePixelRatio);
    this.$canvas.attr('height', this.isHeader ? height * window.devicePixelRatio : 1);

    const ctx = this.canvas.getContext('2d');
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    ctx.translate(TIMELINE_ANIMATION_PADDING, 0);

    // Compute grid spacing (40 = minimum grid spacing in pixels).
    let interval = 0;
    let spacingMs = GRID_INTERVALS_MS[interval];
    while ((spacingMs * this.horizZoom) < 40 || interval >= GRID_INTERVALS_MS.length) {
      interval++;
      spacingMs = GRID_INTERVALS_MS[interval];
    }

    const spacingPx = spacingMs * this.horizZoom;

    if (this.isHeader) {
      // Text labels.
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '10px Roboto';
      for (let x = 0, t = 0;
        round(x) <= round(width);
        x += spacingPx, t += spacingMs) {
        ctx.fillText(`${t / 1000}s`, x, height / 2);
      }
      ctx.fillStyle = 'rgba(244, 67, 54, .7)';
      ctx.beginPath();
      ctx.arc(this.currentTime * this.horizZoom, height / 2, 4, 0, 2 * Math.PI, false);
      ctx.fill();
      ctx.closePath();
      ctx.fillRect(this.currentTime * this.horizZoom - 1, height / 2 + 4, 2, height);
    } else {
      // Grid lines.
      ctx.fillStyle = 'rgba(0,0,0,0.1)';
      for (let x = spacingPx;
        round(x) < round(width - TIMELINE_ANIMATION_PADDING * 2);
        x += spacingPx) {
        ctx.fillRect(x - 0.5, 0, 1, 1);
      }
      ctx.fillStyle = 'rgba(244, 67, 54, .7)';
      ctx.fillRect(this.currentTime * this.horizZoom - 1, 0, 2, 1);
    }
  }

  @HostListener('click', ['$event'])
  onClick(event: MouseEvent) {
    // This ensures that click events originating on top of the
    // host element aren't triggered in the component.
    event.stopPropagation();
  }
}

function round(n: number) {
  return _.round(n, 8);
}

export interface ScrubEvent {
  time: number;
  disableSnap: boolean;
}
