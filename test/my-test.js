import {Injector} from 'didi';
import {expect} from 'chai';

describe('Injector', function() {
  it('should be a function', function() {
    function Person(name) {
      this.name = name;
    }
    const personModule = {
      person: ['type', Person]
    };
    function Driver() {
      this.drive = function() {
        console.log('The driver started driving')
      }
    }

    const driverModule = {
      __exports__: ['driver'],
      __depends__: [personModule],
      driver: ['type', Driver]
    };

    function Car(engine) {
      this.start = function() {
        engine.start();
      };
    }
    function createPetrolEngine(power) {
      return {
        start: function() {
          console.log('Starting engine with ' + power + 'hp');
        }
      };
    }

    // define a (didi) module - it declares available
    // components by name and specifies how these are provided
    const carModule = {
      __depends__: [driverModule],

      // asked for 'car', the injector will call new Car(...) to produce it
      'car': [ 'type', Car ],

      // asked for 'engine', the injector will call createPetrolEngine(...) to produce it
      'engine': [ 'factory', createPetrolEngine ],

      // asked for 'power', the injector will give it number 1184
      'power': [ 'value', 1184 ] // probably Bugatti Veyron
    };

    // instantiate an injector with a set of (didi) modules
    const injector = new Injector([
      carModule
    ]);
    console.log('dididi');

    // use the injector API to retrieve components
    injector.get('car').start();

    injector.get('driver').drive();

    // alternatively invoke a function, injecting the arguments
    injector.invoke(function(car) {
      console.log('started', car);
    });
    const car = injector.get('car');
    car.start();
  });
});