/*
    Based in part on observable arrays from Motorola Mobility’s Montage
    Copyright (c) 2012, Motorola Mobility LLC. All Rights Reserved.
    3-Clause BSD License
    https://github.com/motorola-mobility/montage/blob/master/LICENSE.md
*/

/*
    This module is responsible for observing changes to owned properties of
    objects and changes to the content of arrays caused by method calls.
    The interface for observing array content changes establishes the methods
    necessary for any collection with observable content.
*/



// objectHasOwnProperty.call(myObject, key) will be used instead of
// myObject.hasOwnProperty(key) to allow myObject have defined
// a own property called "hasOwnProperty".

var objectHasOwnProperty = Object.prototype.hasOwnProperty;

// Object property descriptors carry information necessary for adding,
// removing, dispatching, and shorting events to listeners for property changes
// for a particular key on a particular object.  These descriptors are used
// here for shallow property changes.  The current listeners are the ones
// modified by add and remove own property change listener methods.  During
// property change dispatch, we capture a snapshot of the current listeners in
// the active change listeners array.  The descriptor also keeps a memo of the
// corresponding handler method names.
//
// {
//     willChangeListeners:{current, active:Array<Function>, ...method names}
//     changeListeners:{current, active:Array<Function>, ...method names}
// }

// Maybe remove entries from this table if the corresponding object no longer
// has any property change listeners for any key.  However, the cost of
// book-keeping is probably not warranted since it would be rare for an
// observed object to no longer be observed unless it was about to be disposed
// of or reused as an observable.  The only benefit would be in avoiding bulk
// calls to dispatchOwnPropertyChange events on objects that have no listeners.

//  To observe shallow property changes for a particular key of a particular
//  object, we install a property descriptor on the object that overrides the previous
//  descriptor.  The overridden descriptors are stored in this weak map.  The
//  weak map associates an object with another object that maps property names
//  to property descriptors.
//
//  object.__overriddenPropertyDescriptors__[key]
//
//  We retain the old descriptor for various purposes.  For one, if the property
//  is no longer being observed by anyone, we revert the property descriptor to
//  the original.  For "value" descriptors, we store the actual value of the
//  descriptor on the overridden descriptor, so when the property is reverted, it
//  retains the most recently set value.  For "get" and "set" descriptors,
//  we observe then forward "get" and "set" operations to the original descriptor.

module.exports = PropertyChanges;

function PropertyChanges() {
    throw new Error("This is an abstract interface. Mix it. Don't construct it");
}

require("../shim");
var Map = require("../_map");
var WeakMap = require("../weak-map");
var ChangeDescriptor = require("./change-descriptor"),
    ObjectChangeDescriptor = ChangeDescriptor.ObjectChangeDescriptor,
    ListenerGhost = ChangeDescriptor.ListenerGhost;

PropertyChanges.debug = true;

var ObjectsPropertyChangeListeners = new WeakMap();

var ObjectChangeDescriptorName = new Map();

    //key -> WeakMap [object -> value]
var ObjectValuesByKey = new Map();
PropertyChanges.objectValuesForKey = function (key) {
    return ObjectValuesByKey.get(key) || ObjectValuesByKey.set(key,new WeakMap).get(key);
}

PropertyChanges.ObjectChangeDescriptor = function () {

}

PropertyChanges.prototype.getOwnPropertyChangeDescriptor = function (key) {
    var objectPropertyChangeDescriptors = ObjectsPropertyChangeListeners.get(this), keyChangeDescriptor;
    if (!objectPropertyChangeDescriptors) {
        objectPropertyChangeDescriptors = Object.create(null);
        ObjectsPropertyChangeListeners.set(this, objectPropertyChangeDescriptors);
    }
    if ((keyChangeDescriptor = objectPropertyChangeDescriptors[key]) === void 0) {
        var propertyName = ObjectChangeDescriptorName.get(key);
        if (!propertyName) {
            propertyName = String(key);
            propertyName = propertyName && propertyName[0].toUpperCase() + propertyName.slice(1);
            ObjectChangeDescriptorName.set(key, propertyName);
        }
        return objectPropertyChangeDescriptors[key] = new ObjectChangeDescriptor(propertyName);
    }
    else return keyChangeDescriptor;
};

PropertyChanges.prototype.hasOwnPropertyChangeDescriptor = function (key) {
    var objectPropertyChangeDescriptors = ObjectsPropertyChangeListeners.get(this);
    if (!objectPropertyChangeDescriptors) {
        return false;
    }
    if (!key) {
        return true;
    }
    if (objectPropertyChangeDescriptors[key] === void 0) {
        return false;
    }
    return true;
};

PropertyChanges.prototype.addOwnPropertyChangeListener = function (key, listener, beforeChange) {
    if (this.makeObservable && !this.isObservable) {
        this.makeObservable(); // particularly for observable arrays, for
        // their length property
    }
    var descriptor = PropertyChanges.getOwnPropertyChangeDescriptor(this, key),
        listeners = beforeChange ? descriptor.willChangeListeners : descriptor.changeListeners;

    PropertyChanges.makePropertyObservable(this, key);

    if (!listeners._current) {
        listeners._current = listener;
        // if(key === "value") console.log("^^^^ addOwnPropertyChangeListener:",Object.hash(this),this,key,listeners._current);
    }
    else if (!Array.isArray(listeners._current)) {
        listeners._current = [listeners._current, listener]
    }
    else {
        listeners._current.push(listener);
    }

    var self = this;
    return function cancelOwnPropertyChangeListener() {
        PropertyChanges.removeOwnPropertyChangeListener(self, key, listener, beforeChange);
        self = null;
    };
};

PropertyChanges.prototype.addBeforeOwnPropertyChangeListener = function (key, listener) {
    return PropertyChanges.addOwnPropertyChangeListener(this, key, listener, true);
};

PropertyChanges.prototype.removeOwnPropertyChangeListener = function removeOwnPropertyChangeListener(key, listener, beforeChange) {
    var descriptor = PropertyChanges.getOwnPropertyChangeDescriptor(this, key);

    var listeners;
    if (beforeChange) {
        listeners = descriptor._willChangeListeners;
    } else {
        listeners = descriptor._changeListeners;
    }

    if (listeners) {
        if (listeners._current) {
            if (listeners._current === listener) {
                listeners._current = null;
            }
            else {

                var index = listeners._current.lastIndexOf(listener);
                if (index === -1) {
                    throw new Error("Can't remove property change listener: does not exist: property name" + JSON.stringify(key));
                }
                if (descriptor.isActive) {
                    listeners.ghostCount = listeners.ghostCount + 1;
                    listeners._current[index] = removeOwnPropertyChangeListener.ListenerGhost;
                }
                else {
                    listeners._current.spliceOne(index);
                }
            }
        }
    }
};
PropertyChanges.prototype.removeOwnPropertyChangeListener.ListenerGhost = ListenerGhost;

PropertyChanges.prototype.removeBeforeOwnPropertyChangeListener = function (key, listener) {
    return PropertyChanges.removeOwnPropertyChangeListener(this, key, listener, true);
};

PropertyChanges.prototype.dispatchOwnPropertyChange = function dispatchOwnPropertyChange(key, value, beforeChange) {
    var descriptor = PropertyChanges.getOwnPropertyChangeDescriptor(this, key),
        listeners;

    if (!descriptor.isActive) {
        descriptor.isActive = true;
        listeners = beforeChange ? descriptor._willChangeListeners : descriptor._changeListeners;
        try {
            dispatchOwnPropertyChange.dispatchEach(listeners, key, value, this);
        } finally {
            descriptor.isActive = false;
        }
    }
};
PropertyChanges.prototype.dispatchOwnPropertyChange.dispatchEach = dispatchEach;

function dispatchEach(listeners, key, value, object) {
    if (listeners && listeners._current) {
        // copy snapshot of current listeners to active listeners
        var current,
            listener,
            i,
            countI,
            thisp,
            specificHandlerMethodName = listeners.specificHandlerMethodName,
            genericHandlerMethodName = listeners.genericHandlerMethodName,
            Ghost = ListenerGhost;

        if (Array.isArray(listeners._current)) {
            //removeGostListenersIfNeeded returns listeners.current or a new filtered one when conditions are met
            current = listeners.removeCurrentGostListenersIfNeeded();
            //We use a for to guarantee we won't dispatch to listeners that would be added after we started
            for (i = 0, countI = current.length; i < countI; i++) {
                if ((thisp = current[i]) !== Ghost) {
                    //This is fixing the issue causing a regression in Montage's repetition
                    listener = (
                        thisp[specificHandlerMethodName] ||
                        thisp[genericHandlerMethodName] ||
                        thisp
                    );
                    if (!listener.call) {
                        throw new Error("No event listener for " + listeners.specificHandlerName + " or " + listeners.genericHandlerName + " or call on " + listener);
                    }
                    listener.call(thisp, value, key, object);
                }
            }
        }
        else {
            thisp = listeners._current;
            listener = (
                thisp[specificHandlerMethodName] ||
                thisp[genericHandlerMethodName] ||
                thisp
            );
            if (!listener.call) {
                throw new Error("No event listener for " + listeners.specificHandlerName + " or " + listeners.genericHandlerName + " or call on " + listener);
            }
            listener.call(thisp, value, key, object);
        }

    }
}

dispatchEach.ListenerGhost = ListenerGhost;


PropertyChanges.prototype.dispatchBeforeOwnPropertyChange = function (key, listener) {
    return PropertyChanges.dispatchOwnPropertyChange(this, key, listener, true);
};

var ObjectsOverriddenPropertyDescriptors = new WeakMap(),
    PrototypesObservablePropertyDescriptors = new WeakMap();


//We can break this into a method that returns the property descriptor, and one that actually put it in place, which could give a fairly straightforward path to have the wrapper put on the prototype vs on the object itself.
//Another opportunity is to cache the wrapper per key, as it is the only variable in the closure. So we wouldn't spend the time re-creating the structure and instead install it. The method returning the observableProperyForKey would do the cachihg.
PropertyChanges.prototype.makePropertyObservable = function (key) {
    // arrays are special.  we do not support direct setting of properties
    // on an array.  instead, call .set(index, value).  this is observable.
    // 'length' property is observable for all mutating methods because
    // our overrides explicitly dispatch that change.

    if (this.observablePropertyDescriptor) {
        return this.observablePropertyDescriptor(key);
    }
    else {
        // if(key === "value") console.log(Object.hash(this), this,".makePropertyObservable(",key,")");
        var overriddenPropertyDescriptors = ObjectsOverriddenPropertyDescriptors.get(this),
            observablePropertyDescriptor = overriddenPropertyDescriptors ? overriddenPropertyDescriptors.get(key) : void 0,
            storage,
            //String length matter, compromise is OPCD, for Own Property Change Descriptor
            ownPropertyChangeDescriptorKey;

        if (!observablePropertyDescriptor) {

            // memoize overridden property descriptor table
            if (!overriddenPropertyDescriptors) {
                if (Array.isArray(this)) {
                    return null;
                }
                if (!Object.isExtensible(this)) {
                    throw new Error("Can't make property " + JSON.stringify(key) + " observable on " + this + " because object is not extensible");
                }
                overriddenPropertyDescriptors = new Map();
                ObjectsOverriddenPropertyDescriptors.set(this, overriddenPropertyDescriptors);
            }

            // //Let see if from Object.getPrototypeOf(this), we can find an existing observablePropertyDescriptor
            var objectPrototype = Object.getPrototypeOf(this),
                observablePropertyDescriptors,
                observablePropertyDescriptor,
                isTypedObject = objectPrototype && objectPrototype !== Object.prototype,
                shouldMakePropertyObservableOnPrototype = PropertyChanges.shouldMakePropertyObservableOnPrototype(this, key);

            //If an object is typed (and not just an instance of Object, we may have it cached for object's prototype)
            if (typeof this !== "function" && isTypedObject) {
                observablePropertyDescriptors = PrototypesObservablePropertyDescriptors.get(objectPrototype);
                observablePropertyDescriptor = (observablePropertyDescriptors
                    ? observablePropertyDescriptors.get(key)
                    : void 0);
            }

            if (!observablePropertyDescriptor) {

                // walk up the prototype chain to find a property descriptor for
                // the property name
                var overridenPrototype = this,
                    overriddenDescriptor;
                do {
                    overriddenDescriptor = Object.getOwnPropertyDescriptor(overridenPrototype, key);
                    if (overriddenDescriptor) {
                        break;
                    }
                    overridenPrototype = Object.getPrototypeOf(overridenPrototype);
                } while (overridenPrototype);

                //We try again for overridenPrototype
                observablePropertyDescriptors = PrototypesObservablePropertyDescriptors.get(overridenPrototype);
                observablePropertyDescriptor = (observablePropertyDescriptors
                    ? observablePropertyDescriptors.get(key)
                    : void 0);

                if (!observablePropertyDescriptor) {
                    observablePropertyDescriptor = {
                        get: void 0,
                        set: void 0,
                        configurable: true,
                        enumerable: false
                    };

                    // or default to an undefined value
                    if (!overriddenDescriptor) {
                        overriddenDescriptor = {
                            value: void 0,
                            enumerable: true,
                            writable: true,
                            configurable: true
                        };
                    } else {
                        if (!overriddenDescriptor.configurable) {
                            return;
                        }
                        if (!overriddenDescriptor.writable && !overriddenDescriptor.set) {
                            return;
                        }
                    }

                    // memoize the descriptor so we know not to install another layer,
                    // and so we can reuse the overridden descriptor when uninstalling
                    overriddenPropertyDescriptors.set(key, overriddenDescriptor);


                    // TODO reflect current value on a displayed property

                    // in both of these new descriptor variants, we reuse the overridden
                    // descriptor to either store the current value or apply getters
                    // and setters.  this is handy since we can reuse the overridden
                    // descriptor if we uninstall the observer.  We even preserve the
                    // assignment semantics, where we get the value from up the
                    // prototype chain, and set as an owned property.

                    if ('value' in overriddenDescriptor) {
                        observablePropertyDescriptor.get = function dispatchingGetter() {
                            //console.log(Object.hash(this),this,key+" value is ",dispatchingGetter.storage.get(this));
                            //return dispatchingGetter.overriddenDescriptor.value;
                            return dispatchingGetter.value;
                            //return dispatchingGetter.storage.get(this);
                        };
                        observablePropertyDescriptor.set = function dispatchingSetter(value) {
                            var descriptor,
                                isActive;
                                //overriddenDescriptor = dispatchingSetter.overriddenDescriptor;

                            if (value !== dispatchingSetter.get.value) {

                                //if (!(isActive = (descriptor = PropertyChanges.getOwnPropertyChangeDescriptor(this, key)).isActive)) {
                                if (!(isActive = (descriptor = dispatchingSetter.descriptor).isActive)) {
                                        descriptor.isActive = true;
                                    try {
                                        dispatchingSetter.dispatchEach(descriptor._willChangeListeners, dispatchingSetter.key, dispatchingSetter.get.value, this);
                                    } finally {}
                                }
                                dispatchingSetter.get.value = value;
                                if (!isActive) {
                                    try {
                                        dispatchingSetter.dispatchEach(descriptor._changeListeners, dispatchingSetter.key, value, this);
                                    } finally {
                                        descriptor.isActive = false;
                                    }
                                }
                            }
                        };

                        // observablePropertyDescriptor.set = function dispatchingSetter(value) {
                        //     var currentValue = dispatchingSetter.storage.get(this);
                        //     if (value !== currentValue) {
                        //         var descriptor = PropertyChanges.getOwnPropertyChangeDescriptor(this, key),
                        //             isActive;

                        //             if(key === "value") console.log("^^^^ dispatchingSetter:",Object.hash(this),this,key,descriptor.changeListeners._current);

                        //         if (descriptor && !(isActive = descriptor.isActive)) {
                        //             descriptor.isActive = true;
                        //             try {
                        //                 dispatchingSetter.dispatchEach(descriptor._willChangeListeners, dispatchingSetter.key, currentValue, this);
                        //             } finally { }
                        //         }
                        //         dispatchingSetter.storage.set(this,value);
                        //         console.log(Object.hash(this),this,key+" value is now ",dispatchingSetter.storage.get(this));
                        //         if (descriptor && !isActive) {
                        //             try {
                        //                 dispatchingSetter.dispatchEach(descriptor._changeListeners, dispatchingSetter.key, value, this);
                        //             } finally {
                        //                 descriptor.isActive = false;
                        //             }
                        //         }
                        //     }
                        // };

                        observablePropertyDescriptor.set.dispatchEach = dispatchEach;
                        observablePropertyDescriptor.set.key = key;
                        //observablePropertyDescriptor.set.storage = observablePropertyDescriptor.get.storage = PropertyChanges.objectValuesForKey(key);
                        observablePropertyDescriptor.set.ownPropertyChangeDescriptorKey = ownPropertyChangeDescriptorKey;
                        //observablePropertyDescriptor.get.overriddenDescriptor = observablePropertyDescriptor.set.overriddenDescriptor = overriddenDescriptor;
                        observablePropertyDescriptor.set.get = observablePropertyDescriptor.get;
                        observablePropertyDescriptor.set.descriptor = ObjectsPropertyChangeListeners.get(this)[key];

                        observablePropertyDescriptor.enumerable = overriddenDescriptor.enumerable;

                        observablePropertyDescriptor.configurable = true;

                    } else { // 'get' or 'set', but not necessarily both
                        observablePropertyDescriptor.get = overriddenDescriptor.get;
                        observablePropertyDescriptor.set = function dispatchingSetter() {
                            // if (key === "object") {
                            //     console.log(">>>>>> Iteration %s dispatchingSetter set object to ", Object.hash(this), arguments[0]);
                            // }

                            var formerValue = dispatchingSetter.overriddenGetter.call(this),
                                descriptor,
                                isActive,
                                newValue;
                            // if (key === "object") {
                            //     console.log(">>>>>> Iteration %s set object to ", Object.hash(this), arguments[0], ". formerValue is ", formerValue);
                            // }

                            if (arguments.length === 1) {
                                dispatchingSetter.overriddenSetter.call(this, arguments[0]);
                            }
                            else if (arguments.length === 2) {
                                dispatchingSetter.overriddenSetter.call(this, arguments[0], arguments[1]);
                            }
                            else {
                                dispatchingSetter.overriddenSetter.apply(this, arguments);
                            }

                            if ((descriptor = PropertyChanges.getOwnPropertyChangeDescriptor(this, key)) && ((newValue = dispatchingSetter.overriddenGetter.call(this)) !== formerValue)) {
                                if (!(isActive = descriptor.isActive)) {
                                    descriptor.isActive = true;
                                    try {
                                        dispatchingSetter.dispatchEach(descriptor._willChangeListeners, key, formerValue, this);
                                    } finally { }
                                }
                                if (!isActive) {
                                    try {
                                        dispatchingSetter.dispatchEach(descriptor._changeListeners, key, newValue, this);
                                    } finally {
                                        descriptor.isActive = false;
                                    }
                                }
                            }
                            else if (this.repetition && this.repetition.identifier === "repetition2" && key === "object") {
                                console.log(">>>>>> Iteration %s set object to ", Object.hash(this), arguments[0], ". newValue [", newValue, "] === formerValue[", formerValue, "]");
                            }
                        };
                        observablePropertyDescriptor.enumerable = overriddenDescriptor.enumerable;
                        observablePropertyDescriptor.configurable = true;
                        observablePropertyDescriptor.set.dispatchEach = dispatchEach;
                        observablePropertyDescriptor.set.overriddenSetter = overriddenDescriptor.set;
                        observablePropertyDescriptor.set.overriddenGetter = overriddenDescriptor.get;
                        observablePropertyDescriptor.set.ownPropertyChangeDescriptorKey = ownPropertyChangeDescriptorKey;
                    }

                    if (isTypedObject && overridenPrototype && !('value' in overriddenDescriptor)) {
                        if (!observablePropertyDescriptors) {
                            observablePropertyDescriptors = new Map();
                            PrototypesObservablePropertyDescriptors.set(overridenPrototype, observablePropertyDescriptors);
                        }
                        observablePropertyDescriptors.set(key, observablePropertyDescriptor);
                    }

                    // if (isTypedObject && overridenPrototype && observablePropertyDescriptor.get.storageKey) {
                    //     //Defines the new private property to hold the value for overriden value property descriptor
                    //     //If the object has a type, we can define a private property efficently once on the prototype
                    //     //If not, we define it on the object itself and initialize it to the right value
                    //     Object.defineProperty(overridenPrototype, storageKey, {
                    //         value: void 0,
                    //         enumerable: false,
                    //         writable: true,
                    //         configurable: true
                    //     });
                    // }

                    //Defines private property to hold the ownPropertyChangeDescriptor for key
                    //If the object has a type, we can define a private property efficently once on the prototype
                    // if (isTypedObject && overridenPrototype) {
                    //     Object.defineProperty(overridenPrototype, ownPropertyChangeDescriptorKey, {
                    //         value: void 0,
                    //         enumerable: false,
                    //         writable: true,
                    //         configurable: true
                    //     });
                    // }

                    if (isTypedObject && shouldMakePropertyObservableOnPrototype && !('value' in overriddenDescriptor)) {
                        Object.defineProperty(overridenPrototype, key, observablePropertyDescriptor);
                    }

                }
            }

            // if (observablePropertyDescriptor.get.storage) {
            //     observablePropertyDescriptor.get.storage.set(this,this[key]);
            //     //this[observablePropertyDescriptor.get.storageKey] = this[key];
            // }
            if (observablePropertyDescriptor.set.get) {
                observablePropertyDescriptor.get.value = this[key];
                //this[observablePropertyDescriptor.get.storageKey] = this[key];
            }

            //Assign the shortcut pointer to the ownPropertyChangeDescriptor for key to a private property on the object for efficiency
            // Object.defineProperty(this, observablePropertyDescriptor.set.ownPropertyChangeDescriptorKey, {
            //     value: ObjectsPropertyChangeListeners.get(this)[key],
            //     enumerable: false,
            //     writable: true,
            //     configurable: true
            // });
            // this[observablePropertyDescriptor.set.ownPropertyChangeDescriptorKey] = ObjectsPropertyChangeListeners.get(this)[key];

            if (!isTypedObject || !shouldMakePropertyObservableOnPrototype) {
                Object.defineProperty(this, key, observablePropertyDescriptor);
            }

        }
    }
};


PropertyChanges.prototype.shouldMakePropertyObservableOnPrototype = function (key) {
    return false;
};



// PropertyChanges.prototype.makePropertyObservable = function (key) {

//     var observablePropertyDescriptor = PropertyChanges._observablePropertyDescriptor(this, key);


//     // if(this.repetition && this.repetition.identifier === "repetition2" && key === "object") {
//     //     console.log(">>>>>> BEFORE Iteration ",Object.hash(this)," makePropertyObservable 'object', text is ", this.object.text, ", propertyDescriptor is ", Object.getOwnPropertyDescriptor(this.constructor.prototype,key).set);
//     // }

//     if (observablePropertyDescriptor) {
//         if(PropertyChanges.shouldMakePropertyObservableOnPrototype(this,key))

//         Object.defineProperty(this, key, observablePropertyDescriptor);
//     }

//     // if(this.repetition && this.repetition.identifier === "repetition2" && key === "object") {
//     //     console.log(">>>>>> AFTER Iteration ",Object.hash(this)," makePropertyObservable 'object', propertyDescriptor is ", Object.getOwnPropertyDescriptor(this,key).set);


//     //     //Test if it works:
//     //     console.log(">>>>>> AFTER Iteration testing calling setter to see if dispatchingSetter is called");
//     //     var value = this.object;
//     //     this.object = value;
//     // }


// };

// constructor functions

PropertyChanges.getOwnPropertyChangeDescriptor = function (object, key) {
    if (object.getOwnPropertyChangeDescriptor) {
        return object.getOwnPropertyChangeDescriptor(key);
    } else {
        return PropertyChanges.prototype.getOwnPropertyChangeDescriptor.call(object, key);
    }
};

PropertyChanges.hasOwnPropertyChangeDescriptor = function (object, key) {
    if (object.hasOwnPropertyChangeDescriptor) {
        return object.hasOwnPropertyChangeDescriptor(key);
    } else {
        return PropertyChanges.prototype.hasOwnPropertyChangeDescriptor.call(object, key);
    }
};

PropertyChanges.addOwnPropertyChangeListener = function (object, key, listener, beforeChange) {
    if (Object.isObject(object)) {
        return object.addOwnPropertyChangeListener
            ? object.addOwnPropertyChangeListener(key, listener, beforeChange)
            : this.prototype.addOwnPropertyChangeListener.call(object, key, listener, beforeChange);
    }
};

PropertyChanges.removeOwnPropertyChangeListener = function (object, key, listener, beforeChange) {
    if (!Object.isObject(object)) {
    } else if (object.removeOwnPropertyChangeListener) {
        return object.removeOwnPropertyChangeListener(key, listener, beforeChange);
    } else {
        return PropertyChanges.prototype.removeOwnPropertyChangeListener.call(object, key, listener, beforeChange);
    }
};

PropertyChanges.dispatchOwnPropertyChange = function (object, key, value, beforeChange) {
    if (!Object.isObject(object)) {
    } else if (object.dispatchOwnPropertyChange) {
        return object.dispatchOwnPropertyChange(key, value, beforeChange);
    } else {
        return PropertyChanges.prototype.dispatchOwnPropertyChange.call(object, key, value, beforeChange);
    }
};

PropertyChanges.addBeforeOwnPropertyChangeListener = function (object, key, listener) {
    return PropertyChanges.addOwnPropertyChangeListener(object, key, listener, true);
};

PropertyChanges.removeBeforeOwnPropertyChangeListener = function (object, key, listener) {
    return PropertyChanges.removeOwnPropertyChangeListener(object, key, listener, true);
};

PropertyChanges.dispatchBeforeOwnPropertyChange = function (object, key, value) {
    return PropertyChanges.dispatchOwnPropertyChange(object, key, value, true);
};

PropertyChanges.makePropertyObservable = function (object, key) {
    if (object.makePropertyObservable) {
        return object.makePropertyObservable(key);
    } else {
        return PropertyChanges.prototype.makePropertyObservable.call(object, key);
    }
};

PropertyChanges.shouldMakePropertyObservableOnPrototype = function (object, key) {
    if (object.shouldMakePropertyObservableOnPrototype) {
        return object.shouldMakePropertyObservableOnPrototype(key);
    } else {
        return PropertyChanges.prototype.shouldMakePropertyObservableOnPrototype.call(object, key);
    }
};
